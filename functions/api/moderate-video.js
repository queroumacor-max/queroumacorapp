// Moderação assíncrona de vídeo via Gemini (frames + áudio nativos).
// O post entra como 'pending'; esta função aprova/rejeita depois.
// Requer: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE, SUPABASE_URL, SUPABASE_ANON_KEY.
import { checkRateLimit, rateLimitResponse } from './_security.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_BYTES = 25 * 1024 * 1024; // acima disso, fica pendente p/ revisão humana

const RUBRIC =
  'Você é um moderador. Analise TODO o vídeo (imagens ao longo do tempo, texto e ÁUDIO/fala) ' +
  'e responda APENAS um JSON: {"flagged":bool,"severity":"none|soft|hard","reasons":[string]}. ' +
  'severity "hard": nudez/pornografia, qualquer conteúdo sexual com menores, violência gráfica/sangue, ' +
  'ódio com ameaça, áudio com ameaça de morte/apologia a abuso. ' +
  'severity "soft": ofensa, golpe/scam, spam, sexual sugestivo, doxxing. ' +
  'severity "none" se seguro (pintura, grafite, arte são seguros). reasons curtas em pt-br.';

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

  const supaUrl = (env.SUPABASE_URL || 'https://uwqebaqweehiljsqkifm.supabase.co').replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || serviceKey;

  // O dono do post precisa ser quem está pedindo a moderação
  let uid = '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey }
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
    const chk = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=user_id,media_url`, { headers: sHeaders });
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
    const v = await fetch(mediaUrl);
    if (!v.ok) throw new Error(`download ${v.status}`);
    videoMime = (v.headers.get('content-type') || 'video/mp4').split(';')[0];
    videoBuf = await v.arrayBuffer();
    if (videoBuf.byteLength > MAX_BYTES) {
      return json({ status: 'pending', reason: 'vídeo grande — enviado para revisão humana' });
    }
  } catch (e) {
    return json({ status: 'pending', reason: 'falha ao baixar vídeo: ' + String(e?.message || e) });
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
      body: JSON.stringify({ status: 'approved' })
    });
    return json({ status: 'approved' });
  } catch (e) {
    // Erro/timeout do Gemini: deixa pendente (fila admin), nunca aprova no escuro
    return json({ status: 'pending', reason: 'análise indisponível: ' + String(e?.message || e) });
  }
}

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
      body: JSON.stringify({ file: { display_name: 'qmc_mod' } })
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
    body: buf
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
    const s = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${apiKey}`);
    const sd = await s.json();
    state = sd?.state; uri = sd?.uri || uri;
  }
  if (state !== 'ACTIVE') throw new Error(`arquivo não ficou ACTIVE (${state})`);
  return uri;
}

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
      })
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

async function rejectPost(supaUrl, sHeaders, postId, mediaUrl) {
  await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: { ...sHeaders, 'Prefer': 'return=minimal' }
  });
  if (mediaUrl && mediaUrl.includes('/posts/')) {
    const path = mediaUrl.split('/posts/').pop();
    try {
      await fetch(`${supaUrl}/storage/v1/object/posts/${path}`, { method: 'DELETE', headers: sHeaders });
    } catch { /* best-effort */ }
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
