// Text-to-speech do Seu Zé. POST { text } -> audio/mpeg.
// Usa OpenAI tts-1 com voz 'onyx' (masculina, grave) para encarnar o
// mestre pintor. Requer OPENAI_API_KEY no Cloudflare Pages.
import { requireAuth, requirePro, checkRateLimit, rateLimitResponse, jsonResponse as json } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'TTS não configurado: defina OPENAI_API_KEY' }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  // Auth + PRO check (fail-open)
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const proCheck = await requirePro(env, auth.user && auth.user.id);
  if (!proCheck.pro) return json({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);

  const rl = await checkRateLimit(env, auth.user && auth.user.id, 'tts', 10);
  if (!rl.allowed) return rateLimitResponse(rl);

  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  if (!text) return json({ error: 'text obrigatório' }, 400);

  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'onyx',
        input: text,
        response_format: 'mp3'
      })
    });
    if (!r.ok) {
      const err = await r.text();
      return json({ error: 'OpenAI ' + r.status + ': ' + err.slice(0, 200) }, 502);
    }
    const audio = await r.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' }
    });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
