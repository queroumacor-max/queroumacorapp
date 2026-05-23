// Transcrição de áudio via OpenAI Whisper. Recebe multipart com o campo
// 'audio' e devolve { text } ou { error }. Requer OPENAI_API_KEY no
// Cloudflare Pages.
import { getTokenFromForm, requireAuth, requirePro, checkRateLimit, rateLimitResponse } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'Transcrição não configurada: defina OPENAI_API_KEY' }, 503);
  }

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ error: 'FormData inválido' }, 400); }

  // Auth + PRO check (fail-open) — token vem no FormData ou header
  const accessToken = getTokenFromForm(request, formData);
  const auth = await requireAuth(env, request, { accessToken });
  if (auth.error) return json({ error: auth.error }, auth.status);
  const proCheck = await requirePro(env, auth.user && auth.user.id);
  if (!proCheck.pro) return json({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);

  const rl = await checkRateLimit(env, auth.user && auth.user.id, 'transcribe', 10);
  if (!rl.allowed) return rateLimitResponse(rl);

  const audio = formData.get('audio');
  if (!audio) return json({ error: 'audio obrigatório' }, 400);

  // Whisper aceita até 25 MB
  const size = audio.size || 0;
  if (size > 25 * 1024 * 1024) return json({ error: 'Áudio acima de 25 MB' }, 413);

  const upstream = new FormData();
  upstream.append('file', audio, 'audio.webm');
  upstream.append('model', 'whisper-1');
  upstream.append('language', 'pt');

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.OPENAI_API_KEY },
      body: upstream
    });
    if (!r.ok) {
      const errText = await r.text();
      return json({ error: 'OpenAI ' + r.status + ': ' + errText.slice(0, 200) }, 502);
    }
    const data = await r.json();
    return json({ text: (data && data.text) || '' });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
