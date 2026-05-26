// @ts-check
// Moderação assíncrona de vídeo via Gemini (frames + áudio nativos).
// O post entra como 'pending'; esta função aprova/rejeita depois.
// Requer: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE, SUPABASE_URL, SUPABASE_ANON_KEY.
import { checkRateLimit, rateLimitResponse, jsonResponse as json, FALLBACK_SUPABASE_URL } from './_security.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_BYTES = 25 * 1024 * 1024; // acima disso, fica pendente p/ revisão humana

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

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  // Aceita 3 nomes de service key pra compatibilidade
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.GEMINI_API_KEY || !serviceKey) {
    return json({ status: 'pending', error: 'moderação de vídeo não configurada' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
  const postId = typeof body?.postId === 'string' ? body.postId : '';
  const caption = typeof body?.caption === 'string' ? body.caption.slice(0, 2000) : '';
  // body.mediaUrl é IGNORADO — pegamos do DB pra evitar atacante controlar URL
  // arbitrária (SSRF + custo: forçava o worker a baixar 25 MB de qualquer host)

  if (!postId) return json({ error: 'postId obrigatório' }, 400);

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || serviceKey;

  // O dono do post precisa ser quem está pedindo a moderação
  let uid = '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!u.ok) return json({ error: 'token inválido' }, 401);
    uid = (await u.json())?.id || '';
  } catch { return json({ error: 'falha ao validar token' }, 401); }
  if (!uid) return json({ error: 'token inválido' }, 401);

  // Rate limit por user (vídeo é caro: 25 MB + 40s de polling Gemini)
  const rl = await checkRateLimit(env, uid, 'moderate-video', 3);
  if (!rl.allowed) return rateLimitResponse(rl);

  const sHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  // Pega media_url AUTORITATIVA do DB (não confia no body)
  let mediaUrl = '';
  try {
    const chk = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=user_id,media_url`, { headers: sHeaders, signal: AbortSignal.timeout(10000) });
    const arr = await chk.json();
    if (!arr?.[0] || arr[0].user_id !== uid) return json({ error: 'não autorizado' }, 403);
    mediaUrl = arr[0].media_url || '';
  } catch { return json({ error: 'post não encontrado' }, 404); }
  if (!mediaUrl) return json({ error: 'post sem media_url' }, 400);

  // Defesa em profundidade: só baixa de Supabase Storage do projeto
  try {
    const u = new URL(mediaUrl);
    if (u.protocol !== 'https:' || !/^[A-Za-z0-9-]+\.supabase\.co$/.test(u.hostname) || !u.pathname.startsWith('/storage/')) {
      return json({ status: 'pending', reason: 'media_url fora do storage do projeto' });
    }
  } catch { return json({ status: 'pending', reason: 'media_url inválida' }); }

  // Baixa o vídeo (com limite de tamanho)
  let videoBuf, videoMime;
  try {
    const v = await fetch(mediaUrl, { signal: AbortSignal.timeout(20000) });
    if (!v.ok) throw new Error(`download ${v.status}`);
    videoMime = (v.headers.get('content-type') || 'video/mp4').split(';')[0];
    videoBuf = await v.arrayBuffer();
    if (videoBuf.byteLength > MAX_BYTES) {
      return json({ status: 'pending', reason: 'vídeo grande — enviado para revisão humana' });
    }
  } catch (e) {
    console.warn('moderate-video download err:', e && e.message);
    return json({ status: 'pending', reason: 'falha ao baixar vídeo' });
  }

  try {
    const fileUri = await uploadToGemini(env.GEMINI_API_KEY, videoBuf, videoMime);
    const verdict = await analyzeVideo(env.GEMINI_API_KEY, fileUri, videoMime, caption);

    if (verdict.severity === 'hard') {
      await rejectPost(supaUrl, sHeaders, postId, mediaUrl);
      return json({ status: 'rejected', reasons: verdict.reasons });
    }
    if (verdict.severity === 'soft' || verdict.flagged) {
      // Continua pendente para a fila admin decidir
      return json({ status: 'pending', reasons: verdict.reasons });
    }
    await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: { ...sHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'approved' }),
      signal: AbortSignal.timeout(10000)
    });
    return json({ status: 'approved' });
  } catch (e) {
    // Erro/timeout do Gemini: deixa pendente (fila admin), nunca aprova no escuro
    console.warn('moderate-video analyze err:', e && e.message);
    return json({ status: 'pending', reason: 'análise indisponível' });
  }
}

/**
 * @param {string} apiKey
 * @param {ArrayBuffer} buf
 * @param {string} mime
 * @returns {Promise<string>}
 */
async function uploadToGemini(apiKey, buf, mime) {
  const start = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buf.byteLength),
        'X-Goog-Upload-Header-Content-Type': mime,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: 'qmc_mod' } }),
      signal: AbortSignal.timeout(45000)
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
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: buf,
    signal: AbortSignal.timeout(45000)
  });
  if (!up.ok) throw new Error(`upload finalize ${up.status}`);
  let info = await up.json();
  let name = info?.file?.name;
  let uri = info?.file?.uri;
  let state = info?.file?.state;

  // Vídeo precisa ficar ACTIVE antes de ser usado
  const deadline = Date.now() + 40000;
  while (state === 'PROCESSING' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    const s = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${apiKey}`, { signal: AbortSignal.timeout(10000) });
    const sd = await s.json();
    state = sd?.state; uri = sd?.uri || uri;
  }
  if (state !== 'ACTIVE') throw new Error(`arquivo não ficou ACTIVE (${state})`);
  return uri;
}

/**
 * @param {string} apiKey
 * @param {string} fileUri
 * @param {string} mime
 * @param {string} caption
 * @returns {Promise<{ flagged: boolean, severity: string, reasons: string[] }>}
 */
async function analyzeVideo(apiKey, fileUri, mime, caption) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: RUBRIC },
            { text: 'Legenda do post: ' + (caption || '(sem legenda)') },
            { file_data: { mime_type: mime, file_uri: fileUri } }
          ]
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(25000)
    }
  );
  if (!r.ok) throw new Error(`analyze ${r.status}`);
  const data = await r.json();
  let parsed = {};
  try { parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'); } catch { parsed = {}; }
  const severity = ['none', 'soft', 'hard'].includes(parsed.severity) ? parsed.severity : (parsed.flagged ? 'soft' : 'none');
  return {
    flagged: !!parsed.flagged || severity !== 'none',
    severity,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 8) : []
  };
}

/**
 * @param {string} supaUrl
 * @param {Record<string, string>} sHeaders
 * @param {string} postId
 * @param {string} mediaUrl
 * @returns {Promise<void>}
 */
async function rejectPost(supaUrl, sHeaders, postId, mediaUrl) {
  await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: { ...sHeaders, 'Prefer': 'return=minimal' },
    signal: AbortSignal.timeout(10000)
  });
  if (mediaUrl && mediaUrl.includes('/posts/')) {
    const rawPath = mediaUrl.split('/posts/').pop() || '';
    // Anti-traversal: bloqueia .. e URL-encoded ..
    const path = (/^[A-Za-z0-9_\-./]+$/.test(rawPath) && !rawPath.includes('..') && !rawPath.includes('%2E') && !rawPath.includes('%2e'))
      ? rawPath : null;
    if (path) {
      try {
        await fetch(`${supaUrl}/storage/v1/object/posts/${path}`, { method: 'DELETE', headers: sHeaders, signal: AbortSignal.timeout(10000) });
      } catch { /* best-effort */ }
    }
  }
}
