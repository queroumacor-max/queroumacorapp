// lib/api/_services/post-approval.ts — o SERVIDOR decide se um post vai ao ar.
//
// Por que existe (2026-09-26): até aqui a moderação era orquestrada pelo
// CLIENTE (`usePublishPost` chamava /api/moderate e depois gravava o post já
// com `status='approved'`). Quem chamasse o PostgREST direto com o próprio
// token publicava sem Gemini e sem a blocklist de hash. Agora:
//   1. o banco força `status='pending'` em todo INSERT de usuário, e mudar
//      mídia/legenda/link depois volta pra pending (trigger
//      `enforce_post_moderation`); o feed só mostra `approved`;
//   2. o cliente cria o post e chama POST /api/posts/approve;
//   3. esta função relê o post do BANCO, COPIA cada mídia pra
//      `posts/approved/<uid>/…` (pasta que só a chave de serviço escreve —
//      o dono não consegue mais trocar os bytes depois de aprovados),
//      modera a CÓPIA (hash + Gemini) e aprova de forma ATÔMICA: o UPDATE só
//      vale se mídia, legenda e link ainda forem os que foram lidos (RPC
//      `approve_post_moderated`). Mudou no meio → não aprova.
//
// Achados do Codex no PR #435 que moldaram isto (P1, os quatro):
//   - legenda/link editados depois de aprovado não voltavam pra moderação;
//   - `media_urls` com mais de 5 itens ou `media_url` fora do array eram
//     exibidos sem moderação;
//   - a aprovação não amarrava o conteúdo moderado (troca no meio passava);
//   - URL de OUTRO projeto Supabase (ou arquivo sobrescrito depois) passava.
//
// Política mantida da versão anterior (não é regra nova):
//   - severidade 'soft' publica e vai pra fila de revisão humana;
//   - Gemini fora do ar publica (fail-open) e vai pra fila;
//   - 'hard' ou hash bloqueado: soft-delete + fila (evidência preservada,
//     nunca DELETE automático — docs/CSAM_POLICY.md).

import { ServiceError, getServiceKey, getSupabaseUrl } from '../security';
import { getRuntimeEnv } from '../env';
import { hashMedia, checkHashBlocklist, enqueueMediaReview } from '../mediaHash';
import { moderateContent } from './moderate';
import { moderateVideoPost } from './moderate-video';
import { isVideoPost } from '../../utils';
import { logSecurityEvent } from '../securityEvents';

const MAX_HASH_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const COPY_TIMEOUT_MS = 30000;
export const MAX_MIDIAS = 5;
const PREFIXO_PUBLICO = '/storage/v1/object/public/posts/';

export type ApprovalStatus = 'approved' | 'rejected';

export interface ApprovalResult {
  status: ApprovalStatus;
  reasons?: string[];
  /** true quando publicou mas deixou na fila de revisão humana. */
  revisao?: boolean;
  video?: boolean;
}

interface PostRow {
  id: string;
  user_id: string;
  status: string | null;
  media_url: string | null;
  media_urls?: string[] | null;
  media_type: string | null;
  caption: string | null;
  link_url?: string | null;
  deleted_at: string | null;
}

function base(): string {
  return getSupabaseUrl().replace(/\/$/, '');
}

function serviceHeaders(): Record<string, string> {
  const k = getServiceKey();
  if (!k) {
    console.warn('[post-approval] SUPABASE_SERVICE_ROLE_KEY ausente');
    throw new ServiceError('Serviço indisponível no momento.', 503);
  }
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
}

function postsUrl(query: string): string {
  return `${base()}/rest/v1/posts?${query}`;
}

/**
 * Chave do objeto no bucket `posts` DESTE projeto, ou null. Só aceita o host
 * exato do projeto (qualquer `*.supabase.co` deixaria usar um bucket que o
 * atacante controla e troca depois).
 */
export function chaveNoBucketPosts(urlStr: string, projetoUrl: string): string | null {
  try {
    const u = new URL(urlStr);
    const p = new URL(projetoUrl);
    if (u.protocol !== 'https:' || u.host !== p.host) return null;
    if (!u.pathname.startsWith(PREFIXO_PUBLICO)) return null;
    const chave = decodeURIComponent(u.pathname.slice(PREFIXO_PUBLICO.length));
    if (!chave || chave.includes('..') || chave.startsWith('/')) return null;
    return chave;
  } catch {
    return null;
  }
}

/**
 * Todas as mídias que alguma tela exibe (a 1ª em `media_url`, o carrossel em
 * `media_urls`), sem repetição e na ordem. `null` = conjunto inválido (mais
 * que o limite) — a tela nunca produz isso; só a API direta.
 */
export function midiasExibidas(post: Pick<PostRow, 'media_url' | 'media_urls'>): string[] | null {
  const todas = [post.media_url, ...(post.media_urls || [])].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  const unicas = Array.from(new Set(todas));
  return unicas.length > MAX_MIDIAS ? null : unicas;
}

async function lerPost(postId: string): Promise<PostRow | null> {
  const cols = 'id,user_id,status,media_url,media_urls,media_type,caption,link_url,deleted_at';
  const r = await fetch(postsUrl(`id=eq.${encodeURIComponent(postId)}&select=${cols}`), {
    headers: serviceHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new ServiceError('falha ao ler o post', 502);
  const rows = (await r.json()) as PostRow[];
  return rows?.[0] ?? null;
}

async function patchPost(postId: string, filtro: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(postsUrl(`id=eq.${encodeURIComponent(postId)}${filtro}`), {
    method: 'PATCH',
    headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new ServiceError('falha ao gravar o post', 502);
}

async function rejeitar(postId: string): Promise<void> {
  await patchPost(postId, '', { status: 'rejected', deleted_at: new Date().toISOString() });
}

/**
 * Copia a mídia pra `approved/<uid>/<postId>-<i>-<nome>` (fora da pasta do
 * usuário: a policy de Storage só deixa o dono escrever em `<uid>/…`).
 * Mídia já dentro da pasta aprovada DESTE post é reaproveitada (reaprovação
 * depois de editar a legenda). Qualquer outra origem → null (inválida).
 */
async function copiarParaAprovados(args: {
  url: string;
  userId: string;
  postId: string;
  indice: number;
}): Promise<string | null> {
  const projeto = base();
  const chave = chaveNoBucketPosts(args.url, projeto);
  if (!chave) return null;
  const pastaAprovada = `approved/${args.userId}/${args.postId}-`;
  if (chave.startsWith(pastaAprovada)) return args.url;
  if (!chave.startsWith(`${args.userId}/`)) return null;

  const nome = chave.split('/').pop() || 'midia';
  const destino = `${pastaAprovada}${args.indice}-${nome}`;
  const r = await fetch(`${projeto}/storage/v1/object/copy`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ bucketId: 'posts', sourceKey: chave, destinationKey: destino }),
    signal: AbortSignal.timeout(COPY_TIMEOUT_MS),
  });
  // 409/400 "Duplicate": uma tentativa anterior já copiou — a cópia é nossa,
  // ninguém mais escreve em approved/.
  if (!r.ok && r.status !== 409) {
    const corpo = await r.text().catch(() => '');
    if (!/duplicate|already exists/i.test(corpo)) {
      throw new ServiceError('falha ao preparar a mídia', 502);
    }
  }
  return `${projeto}${PREFIXO_PUBLICO}${destino.split('/').map(encodeURIComponent).join('/')}`;
}

/** Baixa a mídia e devolve o SHA-256 (vazio se não deu). */
async function hashDaUrl(url: string): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return '';
    const buf = await r.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_HASH_BYTES) return '';
    return await hashMedia(buf);
  } catch {
    return '';
  }
}

type Veredito =
  | { tipo: 'ok'; hash: string }
  | { tipo: 'revisar'; hash: string; motivo: string }
  | { tipo: 'bloquear'; hash: string; motivo: string; severity: 'high' | 'critical' };

async function avaliar(args: { url?: string; texto?: string }): Promise<Veredito> {
  const hash = args.url ? await hashDaUrl(args.url) : '';
  if (hash) {
    const hit = await checkHashBlocklist(hash);
    if (hit.blocked) {
      return {
        tipo: 'bloquear',
        hash,
        motivo: `blocklist:${hit.category || 'reported'}`,
        severity: hit.category === 'csam' ? 'critical' : 'high',
      };
    }
  }
  if (!args.url && !(args.texto || '').trim()) return { tipo: 'ok', hash };
  if (!getRuntimeEnv('GEMINI_API_KEY')) {
    return { tipo: 'revisar', hash, motivo: 'moderacao_indisponivel' };
  }
  try {
    const r = await moderateContent({ text: args.texto, imageUrl: args.url });
    if (r.severity === 'hard') {
      return {
        tipo: 'bloquear',
        hash,
        motivo: r.reasons.join(',') || 'gemini_flagged_hard',
        severity: r.reasons.some((x) => /sexual_menores|csam/i.test(x)) ? 'critical' : 'high',
      };
    }
    if (r.flagged) return { tipo: 'revisar', hash, motivo: r.reasons.join(',') || 'gemini_flagged' };
    return { tipo: 'ok', hash };
  } catch {
    // Gemini fora do ar/timeout: publica, mas alguém revisa depois.
    return { tipo: 'revisar', hash, motivo: 'moderacao_indisponivel' };
  }
}

/** Literal de array do Postgres (`{"a","b"}`) pro filtro `eq` do PostgREST. */
export function literalDeArray(itens: string[]): string {
  return '{' + itens.map((x) => '"' + x.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
}

/** Legenda + link: o texto que o post mostra. */
function textoDoPost(post: PostRow): string {
  return [post.caption || '', post.link_url || ''].filter(Boolean).join('\n');
}

/**
 * Aprova SÓ se o post ainda estiver exatamente como foi lido (compare-and-
 * set). Grava as URLs das cópias aprovadas no lugar das originais. Devolve
 * false se algo mudou no meio (o post segue pending).
 */
async function aprovarSeInalterado(
  post: PostRow,
  novas: { mediaUrl: string | null; mediaUrls: string[] | null; mediaHash: string | null },
): Promise<boolean> {
  const r = await fetch(`${base()}/rest/v1/rpc/approve_post_moderated`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_post_id: post.id,
      p_old_media_url: post.media_url,
      p_old_media_urls: post.media_urls ?? null,
      p_old_caption: post.caption,
      p_old_link_url: post.link_url ?? null,
      p_new_media_url: novas.mediaUrl,
      p_new_media_urls: novas.mediaUrls,
      p_media_hash: novas.mediaHash,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (r.ok) return (await r.json().catch(() => false)) === true;
  const corpo = await r.text().catch(() => '');
  // RPC ainda não criada (SQL pendente): publicar não pode parar por isso.
  // Cai num PATCH condicional pela 1ª mídia + releitura — mais fraco que o
  // compare-and-set (janela de milissegundos entre os dois passos), por isso
  // é só a ponte até o SQL rodar.
  if (r.status === 404 || /PGRST202|42883/.test(corpo)) {
    const filtroMidia =
      (post.media_url ? `&media_url=eq.${encodeURIComponent(post.media_url)}` : '&media_url=is.null') +
      (post.media_urls
        ? `&media_urls=eq.${encodeURIComponent(literalDeArray(post.media_urls))}`
        : '&media_urls=is.null');
    await patchPost(post.id, `&status=eq.pending${filtroMidia}`, {
      status: 'approved',
      media_url: novas.mediaUrl,
      media_urls: novas.mediaUrls,
      ...(novas.mediaHash ? { media_hash: novas.mediaHash } : {}),
    });
    const agora = await lerPost(post.id);
    const intacto =
      !!agora &&
      agora.status === 'approved' &&
      agora.media_url === novas.mediaUrl &&
      JSON.stringify(agora.media_urls ?? null) === JSON.stringify(novas.mediaUrls ?? null) &&
      (agora.caption ?? null) === (post.caption ?? null) &&
      (agora.link_url ?? null) === (post.link_url ?? null);
    if (!intacto && agora?.status === 'approved') {
      await patchPost(post.id, '', { status: 'pending' });
    }
    return intacto;
  }
  console.warn('[post-approval] approve_post_moderated falhou', r.status, corpo);
  throw new ServiceError('falha ao publicar', 502);
}

/**
 * Modera e aprova um post `pending`. Idempotente: post já aprovado volta
 * 'approved' sem refazer nada. Lança ServiceError 403 (não é o dono),
 * 404 (não existe/apagado), 409 (estado que não se aprova ou mudou durante a
 * análise — o cliente pode pedir de novo).
 */
export async function approvePost(args: {
  userId: string;
  postId: string;
  /** Legenda/link acabaram de ser editados: revalida o TEXTO mesmo se o
   *  post ainda constar 'approved' (antes do SQL de 2026-09-26 (b) o banco
   *  não volta o post pra pending na edição — achado do Codex no #437). */
  revalidarTexto?: boolean;
}): Promise<ApprovalResult> {
  const { userId, postId } = args;
  const post = await lerPost(postId);
  if (!post || post.deleted_at) throw new ServiceError('post não encontrado', 404);
  if (post.user_id !== userId) {
    logSecurityEvent(
      'security.authorization.denied',
      { reason: 'not_owner', resource: 'post', userId, postId },
      { severity: 'warning' },
    );
    throw new ServiceError('não autorizado', 403);
  }
  if (post.status === 'approved' || post.status === null) {
    if (!args.revalidarTexto) return { status: 'approved' };
    // A mídia desse post já foi aprovada (e é cópia imutável); só o texto é
    // novo. Moderamos só ele.
    const v = await avaliar({ texto: textoDoPost(post) });
    if (v.tipo === 'bloquear') {
      await rejeitar(postId);
      await enqueueMediaReview({
        postId,
        userId,
        mediaUrl: post.media_url || '',
        mediaHash: '',
        reason: v.motivo,
        severity: v.severity,
      });
      return { status: 'rejected', reasons: v.motivo.split(',') };
    }
    if (v.tipo === 'revisar') {
      await enqueueMediaReview({
        postId,
        userId,
        mediaUrl: post.media_url || '',
        mediaHash: '',
        reason: v.motivo,
        severity: 'med',
      });
    }
    return { status: 'approved', revisao: v.tipo === 'revisar' };
  }
  if (post.status !== 'pending') throw new ServiceError(`post em estado ${post.status}`, 409);

  // ── Mídias: conjunto completo que as telas exibem, copiado pra pasta
  //    imutável. Origem inválida = rejeita sem gastar Gemini. ──
  const originais = midiasExibidas(post);
  if (!originais) {
    await rejeitar(postId);
    return { status: 'rejected', reasons: ['midias_demais'] };
  }
  const copias: string[] = [];
  for (let i = 0; i < originais.length; i++) {
    const c = await copiarParaAprovados({ url: originais[i], userId, postId, indice: i });
    if (!c) {
      logSecurityEvent(
        'security.post.invalid_media_origin',
        { userId, postId },
        { severity: 'warning' },
      );
      await rejeitar(postId);
      return { status: 'rejected', reasons: ['midia_invalida'] };
    }
    copias.push(c);
  }
  const novaMediaUrl = copias[0] ?? null;
  const novasMediaUrls = copias.length > 1 ? copias : post.media_urls ? copias : null;
  const texto = textoDoPost(post);

  // ── Vídeo: pipeline própria, sobre a CÓPIA, sem aprovar sozinha. ──
  if (isVideoPost(post.media_url, post.media_type) && novaMediaUrl) {
    const out = await moderateVideoPost({
      userId,
      postId,
      caption: texto,
      mediaUrlOverride: novaMediaUrl,
      aprovar: false,
    });
    if (out.status === 'rejected') return { status: 'rejected', reasons: out.reasons, video: true };
    const ok = await aprovarSeInalterado(post, {
      mediaUrl: novaMediaUrl,
      mediaUrls: novasMediaUrls,
      mediaHash: null,
    });
    if (!ok) throw new ServiceError('o post mudou durante a análise', 409);
    return { status: 'approved', revisao: out.status === 'pending', video: true };
  }

  // ── Fotos: TODAS, em paralelo; o texto vai junto da 1ª (ou sozinho). ──
  const vereditos: Veredito[] =
    copias.length === 0
      ? [await avaliar({ texto })]
      : await Promise.all(copias.map((url, i) => avaliar({ url, texto: i === 0 ? texto : undefined })));

  const bloqueio = vereditos.findIndex((v) => v.tipo === 'bloquear');
  if (bloqueio >= 0) {
    const v = vereditos[bloqueio] as Extract<Veredito, { tipo: 'bloquear' }>;
    await rejeitar(postId);
    await enqueueMediaReview({
      postId,
      userId,
      mediaUrl: copias[bloqueio] || '',
      mediaHash: v.hash,
      reason: v.motivo,
      severity: v.severity,
    });
    return { status: 'rejected', reasons: v.motivo.split(',') };
  }

  const revisar = vereditos
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: Extract<Veredito, { tipo: 'revisar' }>; i: number } => x.v.tipo === 'revisar');
  for (const { v, i } of revisar) {
    await enqueueMediaReview({
      postId,
      userId,
      mediaUrl: copias[i] || '',
      mediaHash: v.hash,
      reason: v.motivo,
      severity: 'med',
    });
  }

  // Hash da 1ª mídia calculado AQUI, dos bytes da cópia — o que o cliente
  // mandou em `media_hash` não vale nada (ele pode mentir).
  const ok = await aprovarSeInalterado(post, {
    mediaUrl: novaMediaUrl,
    mediaUrls: novasMediaUrls,
    mediaHash: vereditos[0]?.hash || null,
  });
  if (!ok) throw new ServiceError('o post mudou durante a análise', 409);
  return { status: 'approved', revisao: revisar.length > 0 };
}
