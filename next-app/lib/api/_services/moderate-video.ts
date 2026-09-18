// lib/api/_services/moderate-video.ts — port de
// `functions/api/_services/moderate-video.js`. Frame-by-frame video moderation
// via Gemini (resumable file upload).
//
// AUDITORIA DE SEGURANÇA DE IA (2026-09-17): até aqui, severity="hard" fazia
// um DELETE PERMANENTE do post + arquivo do Storage — decisão 100% do
// veredito do LLM, sem hash-blocklist prévia (ao contrário de `moderate.ts`,
// que já tinha isso pra imagem) e sem NENHUMA revisão humana. Isso violava a
// própria política do projeto (ver `docs/CSAM_POLICY.md`: "não considerar
// LLM/vision comum um detector confiável de CSAM") e era estritamente PIOR
// que o fluxo manual do admin (`blockMediaPermanent`/`escalateToNcmec` em
// `lib/services/mediaReviewAdmin.ts`), que sempre faz SOFT-delete
// (`deleted_at`) pra preservar evidência antes de um humano decidir — um
// DELETE de verdade destruiria a prova que o próprio processo de NCMEC exige.
// Agora "hard" (por hash OU por Gemini) SOFT-deleta o post (mesmo efeito
// prático: some do feed na hora) e enfileira em `media_review_queue` pro
// mesmo pipeline de revisão humana que a imagem já usa — nunca mais um
// DELETE automático de conteúdo do usuário decidido só pelo modelo.
import { ServiceError, getServiceKey, getSupabaseUrl, resolveSupabaseEnv } from '../security';
import { getRuntimeEnv } from '../env';
import { hashMedia, checkHashBlocklist, enqueueMediaReview } from '../mediaHash';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_BYTES = 25 * 1024 * 1024;
// Hash de vídeo grande é custo aceitável (já baixamos o buffer inteiro pra
// mandar pro Gemini de qualquer forma) — sem teto extra aqui, MAX_BYTES já
// limita o buffer.

const RUBRIC =
  'Você é um moderador de uma plataforma BRASILEIRA de pintores/grafiteiros. ' +
  'Analise TODO o vídeo (imagens ao longo do tempo, texto e ÁUDIO/fala) e responda APENAS um JSON: ' +
  '{"flagged":bool,"severity":"none|soft|hard","reasons":[string]}.\n' +
  'Modere com PARCIMÔNIA: na dúvida, libere. Falso positivo machuca mais que falso negativo.\n' +
  '\n' +
  'severity "hard" (bloqueio): nudez explícita/pornografia, sexual com menores, ' +
  'violência gráfica real com sangue/cadáveres, ameaça concreta de morte a pessoa específica, ' +
  'apologia a nazismo/terrorismo/abuso infantil, venda explícita de drogas pesadas ou armas de fogo.\n' +
  '\n' +
  'severity "soft" (revisão humana — use com parcimônia): ' +
  'golpe/scam claro (taxa antecipada, "ganhe sem fazer nada"), spam repetitivo, ' +
  'doxxing de terceiro, ofensa pesada direcionada a pessoa real específica.\n' +
  '\n' +
  'severity "none" (LIBERA): arte de pintura/grafite/mural (mesmo polêmico, expressivo ou com nudez artística discreta), ' +
  'telefone/WhatsApp/Instagram/PIX do PRÓPRIO prestador (é como ele trabalha), preço de serviço, ' +
  'link pro próprio Instagram/portfolio, palavrão leve como exclamação brasileira ("foda demais", "puta arte"), ' +
  'críticas a marcas/produtos, termos técnicos ("pistola de pintar", "matar a saudade", "armário").\n' +
  '\n' +
  'reasons curtas em pt-br (ex: "nudez","sexual_menores","golpe","violencia","odio","spam","doxxing").';

export interface ModerateVideoResult {
  status: 'approved' | 'rejected' | 'pending';
  reasons?: string[];
  reason?: string;
}

/**
 * Valida sessão Supabase e retorna o userId. Throw ServiceError em falha.
 */
export async function verifyOwnerToken(args: {
  accessToken: string;
}): Promise<string> {
  // Par ÚNICO: url e anon key do mesmo projeto (ver resolveSupabaseEnv). A
  // service key segue como último recurso pros testes, mas nunca mistura
  // chave de um projeto com url de outro.
  const serviceKey = getServiceKey();
  let supaUrl = '';
  let anonKey = '';
  try {
    const env = resolveSupabaseEnv();
    supaUrl = env.url;
    anonKey = env.anonKey;
  } catch {
    supaUrl = '';
    anonKey = serviceKey || '';
  }
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        apikey: anonKey,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!u.ok) throw new ServiceError('token inválido', 401);
    const data = (await u.json()) as { id?: string };
    if (!data?.id) throw new ServiceError('token inválido', 401);
    return data.id;
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('falha ao validar token', 401);
  }
}

export async function moderateVideoPost(args: {
  userId: string;
  postId: string;
  caption: string;
}): Promise<ModerateVideoResult> {
  const { userId, postId, caption } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('service key não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders: Record<string, string> = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Pega media_url AUTORITATIVA do DB (não confia no body).
  let mediaUrl = '';
  try {
    const chk = await fetch(
      `${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=user_id,media_url`,
      { headers: sHeaders, signal: AbortSignal.timeout(10000) }
    );
    const arr = (await chk.json()) as Array<{ user_id?: string; media_url?: string }>;
    if (!arr?.[0] || arr[0].user_id !== userId) {
      throw new ServiceError('não autorizado', 403);
    }
    mediaUrl = arr[0].media_url || '';
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('post não encontrado', 404);
  }
  if (!mediaUrl) throw new ServiceError('post sem media_url', 400);

  // Preenchido depois do download (ver hash+blocklist abaixo). Declarado
  // aqui porque `pending()` já pode ser chamada ANTES do download (media_url
  // inválida, fora do storage) — nesses casos vai vazio mesmo, o hash só
  // existe depois que o vídeo é baixado.
  let mediaHash = '';

  // Todo caminho 'pending' ENFILEIRA de verdade pra revisão humana
  // (2026-09-17, achado do Codex: `status:'pending'` nunca gravava nada
  // em `media_review_queue` — o post ficava aprovado e público pra
  // sempre, sem NINGUÉM olhar, apesar de "enviado para revisão humana"
  // já estar escrito num dos textos abaixo desde antes desta correção).
  // `enqueueMediaReview` é best-effort (nunca lança) — não precisa de
  // try/catch aqui em volta.
  const pending = async (reason: string, reasons?: string[]): Promise<ModerateVideoResult> => {
    await enqueueMediaReview({
      postId,
      userId,
      mediaUrl,
      mediaHash, // vazio antes do download; preenchido depois (ver abaixo)
      reason: reasons && reasons.length > 0 ? reasons.join(',') : reason,
      severity: 'med',
    });
    return reasons ? { status: 'pending', reason, reasons } : { status: 'pending', reason };
  };

  // Defesa em profundidade: só baixa de Supabase Storage do projeto.
  try {
    const u = new URL(mediaUrl);
    if (
      u.protocol !== 'https:' ||
      !/^[A-Za-z0-9-]+\.supabase\.co$/.test(u.hostname) ||
      !u.pathname.startsWith('/storage/')
    ) {
      return pending('media_url fora do storage do projeto');
    }
  } catch {
    return pending('media_url inválida');
  }

  // Baixa o vídeo (com limite de tamanho).
  let videoBuf: ArrayBuffer;
  let videoMime: string;
  try {
    const v = await fetch(mediaUrl, { signal: AbortSignal.timeout(20000) });
    if (!v.ok) throw new Error(`download ${v.status}`);
    videoMime = (v.headers.get('content-type') || 'video/mp4').split(';')[0];
    videoBuf = await v.arrayBuffer();
    if (videoBuf.byteLength > MAX_BYTES) {
      return pending('vídeo grande — enviado para revisão humana');
    }
  } catch (e) {
    console.warn('moderate-video download err:', e instanceof Error ? e.message : e);
    return pending('falha ao baixar vídeo');
  }

  // Hash + blocklist ANTES de gastar cota do Gemini — mesma defesa em
  // profundidade que `moderate.ts` já tinha pra imagem (item que faltava
  // aqui: vídeo nunca passava por hash nenhum). Reaproveita o buffer já
  // baixado, sem fetch extra.
  try {
    mediaHash = await hashMedia(videoBuf);
  } catch {
    /* falha ao hashear não bloqueia — segue só com Gemini */
  }
  if (mediaHash) {
    const hit = await checkHashBlocklist(mediaHash);
    if (hit.blocked) {
      await softRejectAndEnqueue({
        supaUrl,
        sHeaders,
        postId,
        userId,
        mediaUrl,
        mediaHash,
        reason: `blocklist:${hit.category || 'reported'}`,
        severity: hit.category === 'csam' ? 'critical' : 'high',
      });
      return { status: 'rejected', reasons: ['media_blocked'] };
    }
  }

  const geminiKey = getRuntimeEnv('GEMINI_API_KEY') || '';
  try {
    const fileUri = await uploadToGemini(geminiKey, videoBuf, videoMime);
    const verdict = await analyzeVideo(geminiKey, fileUri, videoMime, caption);

    if (verdict.severity === 'hard') {
      // NUNCA um DELETE automático decidido só pelo modelo: soft-delete
      // (some do feed na hora) + fila de revisão humana — mesmo pipeline
      // que `blockMediaPermanent`/`escalateToNcmec` já usam pra imagem.
      await softRejectAndEnqueue({
        supaUrl,
        sHeaders,
        postId,
        userId,
        mediaUrl,
        mediaHash,
        reason: verdict.reasons.length > 0 ? verdict.reasons.join(',') : 'gemini_flagged_hard',
        severity: verdict.reasons.some((r) => /sexual_menores|csam/i.test(r))
          ? 'critical'
          : 'high',
      });
      return { status: 'rejected', reasons: verdict.reasons };
    }
    if (verdict.severity === 'soft' || verdict.flagged) {
      return pending('gemini_flagged_video', verdict.reasons);
    }
    await fetch(
      `${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`,
      {
        method: 'PATCH',
        headers: { ...sHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'approved' }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return { status: 'approved' };
  } catch (e) {
    console.warn('moderate-video analyze err:', e instanceof Error ? e.message : e);
    return pending('análise indisponível');
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function uploadToGemini(
  apiKey: string,
  buf: ArrayBuffer,
  mime: string
): Promise<string> {
  const start = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buf.byteLength),
        'X-Goog-Upload-Header-Content-Type': mime,
        'Content-Type': 'application/json',
        // Chave no header, não na query string — evita vazamento em logs
        // que registrem a URL. Auditoria Cloudflare 2026-09-13.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({ file: { display_name: 'qmc_mod' } }),
      signal: AbortSignal.timeout(45000),
    }
  );
  if (!start.ok) throw new Error(`upload start ${start.status}`);
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('sem upload url');

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(buf.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: buf,
    signal: AbortSignal.timeout(45000),
  });
  if (!up.ok) throw new Error(`upload finalize ${up.status}`);
  const info = (await up.json()) as {
    file?: { name?: string; uri?: string; state?: string };
  };
  const name = info?.file?.name;
  let uri = info?.file?.uri || '';
  let state = info?.file?.state;

  // Vídeo precisa ficar ACTIVE antes de ser usado.
  const deadline = Date.now() + 40000;
  while (state === 'PROCESSING' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const s = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
    });
    const sd = (await s.json()) as { state?: string; uri?: string };
    state = sd?.state;
    uri = sd?.uri || uri;
  }
  if (state !== 'ACTIVE') throw new Error(`arquivo não ficou ACTIVE (${state})`);
  return uri;
}

async function analyzeVideo(
  apiKey: string,
  fileUri: string,
  mime: string,
  caption: string
): Promise<{ flagged: boolean; severity: 'none' | 'soft' | 'hard'; reasons: string[] }> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: RUBRIC },
              { text: 'Legenda do post: ' + (caption || '(sem legenda)') },
              { file_data: { mime_type: mime, file_uri: fileUri } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!r.ok) throw new Error(`analyze ${r.status}`);
  const data = (await r.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  let parsed: { flagged?: unknown; severity?: unknown; reasons?: unknown } = {};
  try {
    parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
  } catch {
    parsed = {};
  }
  const severity: 'none' | 'soft' | 'hard' =
    parsed.severity === 'soft' || parsed.severity === 'hard'
      ? parsed.severity
      : parsed.flagged
        ? 'soft'
        : 'none';
  return {
    flagged: !!parsed.flagged || severity !== 'none',
    severity,
    reasons: Array.isArray(parsed.reasons) ? (parsed.reasons.slice(0, 8) as string[]) : [],
  };
}

/**
 * Some do feed NA HORA (soft-delete, `deleted_at`) e enfileira pra revisão
 * humana — nunca um DELETE definitivo decidido sozinho pelo modelo. O
 * arquivo do Storage é PRESERVADO de propósito: é a mesma regra do fluxo
 * manual do admin (`blockMediaPermanent`/`escalateToNcmec`), porque destruir
 * o arquivo destruiria também a evidência que um eventual report ao NCMEC
 * exige (ver `docs/CSAM_POLICY.md`). Best-effort: falha aqui não pode
 * reverter a decisão de bloquear o conteúdo (o post já não aparece mais
 * pra ninguém assim que o soft-delete valer).
 */
async function softRejectAndEnqueue(args: {
  supaUrl: string;
  sHeaders: Record<string, string>;
  postId: string;
  userId: string;
  mediaUrl: string;
  mediaHash: string;
  reason: string;
  severity: 'high' | 'critical';
}): Promise<void> {
  const { supaUrl, sHeaders, postId, userId, mediaUrl, mediaHash, reason, severity } = args;
  try {
    await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: { ...sHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.warn('moderate-video soft-delete err:', e instanceof Error ? e.message : e);
  }
  await enqueueMediaReview({ postId, userId, mediaUrl, mediaHash, reason, severity });
}
