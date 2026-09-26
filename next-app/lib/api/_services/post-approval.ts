// lib/api/_services/post-approval.ts — o SERVIDOR decide se um post vai ao ar.
//
// Por que existe (2026-09-26): até aqui a moderação era orquestrada pelo
// CLIENTE (`usePublishPost` chamava /api/moderate e depois gravava o post já
// com `status='approved'`). Quem chamasse o PostgREST direto com o próprio
// token — sem passar pela tela — publicava sem Gemini e sem a blocklist de
// hash. Agora:
//   1. o banco força `status='pending'` em todo INSERT de usuário (trigger
//      `enforce_post_moderation`, migration 2026-09-26-posts-moderation-
//      server-side.sql) e o feed só mostra `approved`;
//   2. o cliente cria o post e chama POST /api/posts/approve;
//   3. esta função relê o post do BANCO (nada vem do cliente), baixa cada
//      mídia, confere hash contra `media_hash_blocklist`, roda o Gemini e só
//      então grava `status='approved'` com a chave de serviço.
//
// Política mantida da versão anterior (não é regra nova):
//   - severidade 'soft' publica e vai pra fila de revisão humana;
//   - Gemini fora do ar publica (fail-open) e vai pra fila — moderação não
//     pode travar quem trabalha, mas agora alguém fica sabendo;
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
const MAX_FOTOS = 5;

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
  deleted_at: string | null;
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
  return `${getSupabaseUrl().replace(/\/$/, '')}/rest/v1/posts?${query}`;
}

export function isStorageDoProjeto(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return (
      u.protocol === 'https:' &&
      /^[A-Za-z0-9-]+\.supabase\.co$/.test(u.hostname) &&
      u.pathname.startsWith('/storage/')
    );
  } catch {
    return false;
  }
}

async function lerPost(postId: string): Promise<PostRow | null> {
  const cols = 'id,user_id,status,media_url,media_urls,media_type,caption,deleted_at';
  const h = serviceHeaders();
  let r = await fetch(postsUrl(`id=eq.${encodeURIComponent(postId)}&select=${cols}`), {
    headers: h,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // `media_urls` (Wave 57) ausente → relê sem ela.
  if (r.status === 400) {
    r = await fetch(
      postsUrl(`id=eq.${encodeURIComponent(postId)}&select=${cols.replace(',media_urls', '')}`),
      { headers: h, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
  }
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

/** Baixa a mídia e devolve o SHA-256 (vazio se não deu). */
async function hashDaUrl(url: string): Promise<string> {
  if (!isStorageDoProjeto(url)) return '';
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

type VereditoFoto =
  | { tipo: 'ok'; hash: string }
  | { tipo: 'revisar'; hash: string; motivo: string }
  | { tipo: 'bloquear'; hash: string; motivo: string; severity: 'high' | 'critical' };

async function avaliarFoto(args: {
  url: string;
  texto?: string;
}): Promise<VereditoFoto> {
  const hash = await hashDaUrl(args.url);
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

/**
 * Modera e aprova um post `pending`. Idempotente: post já aprovado volta
 * 'approved' sem refazer nada. Lança ServiceError 403 (não é o dono),
 * 404 (não existe/apagado) ou 409 (estado que não se aprova).
 */
export async function approvePost(args: {
  userId: string;
  postId: string;
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
  if (post.status === 'approved' || post.status === null) return { status: 'approved' };
  if (post.status !== 'pending') throw new ServiceError(`post em estado ${post.status}`, 409);

  // ── Vídeo: pipeline própria (upload pro Gemini, análise com áudio). ──
  if (isVideoPost(post.media_url, post.media_type)) {
    const out = await moderateVideoPost({ userId, postId, caption: post.caption || '' });
    if (out.status === 'rejected') return { status: 'rejected', reasons: out.reasons, video: true };
    // `moderateVideoPost` já grava 'approved' nos dois outros desfechos;
    // o PATCH condicional abaixo é no-op nesse caso e garante o estado
    // mesmo se aquela escrita tiver falhado.
    await patchPost(postId, '&status=eq.pending', { status: 'approved' });
    return { status: 'approved', revisao: out.status === 'pending', video: true };
  }

  // ── Fotos: TODAS do carrossel, em paralelo; legenda junto da 1ª. ──
  const urls = (post.media_urls && post.media_urls.length > 0
    ? post.media_urls
    : post.media_url
      ? [post.media_url]
      : []
  ).slice(0, MAX_FOTOS);

  let vereditos: VereditoFoto[];
  if (urls.length === 0) {
    // Só texto (a tela não deixa, mas a API sim): modera a legenda.
    const texto = post.caption || '';
    if (!texto.trim()) {
      vereditos = [{ tipo: 'ok', hash: '' }];
    } else if (!getRuntimeEnv('GEMINI_API_KEY')) {
      vereditos = [{ tipo: 'revisar', hash: '', motivo: 'moderacao_indisponivel' }];
    } else {
      try {
        const r = await moderateContent({ text: texto });
        vereditos = [
          r.severity === 'hard'
            ? { tipo: 'bloquear', hash: '', motivo: r.reasons.join(',') || 'texto', severity: 'high' }
            : r.flagged
              ? { tipo: 'revisar', hash: '', motivo: r.reasons.join(',') || 'texto' }
              : { tipo: 'ok', hash: '' },
        ];
      } catch {
        vereditos = [{ tipo: 'revisar', hash: '', motivo: 'moderacao_indisponivel' }];
      }
    }
  } else {
    vereditos = await Promise.all(
      urls.map((url, i) => avaliarFoto({ url, texto: i === 0 ? post.caption || '' : undefined })),
    );
  }

  const bloqueio = vereditos.findIndex((v) => v.tipo === 'bloquear');
  if (bloqueio >= 0) {
    const v = vereditos[bloqueio] as Extract<VereditoFoto, { tipo: 'bloquear' }>;
    await patchPost(postId, '', { status: 'rejected', deleted_at: new Date().toISOString() });
    await enqueueMediaReview({
      postId,
      userId,
      mediaUrl: urls[bloqueio] || '',
      mediaHash: v.hash,
      reason: v.motivo,
      severity: v.severity,
    });
    return { status: 'rejected', reasons: v.motivo.split(',') };
  }

  const revisar = vereditos
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v.tipo === 'revisar');
  for (const { v, i } of revisar) {
    await enqueueMediaReview({
      postId,
      userId,
      mediaUrl: urls[i] || '',
      mediaHash: v.hash,
      reason: (v as { motivo: string }).motivo,
      severity: 'med',
    });
  }

  // Hash da 1ª foto calculado AQUI, dos bytes reais — o que o cliente
  // mandou em `media_hash` não vale nada (ele pode mentir).
  const primeiroHash = vereditos[0]?.hash;
  await patchPost(postId, '&status=eq.pending', {
    status: 'approved',
    ...(primeiroHash ? { media_hash: primeiroHash } : {}),
  });
  return { status: 'approved', revisao: revisar.length > 0 };
}
