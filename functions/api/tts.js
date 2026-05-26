// Text-to-speech do Seu Zé. POST { text } -> audio/mpeg.
// Usa OpenAI tts-1 com voz 'onyx' (masculina, grave) para encarnar o
// mestre pintor. Requer OPENAI_API_KEY no Cloudflare Pages.
import { gateProAI, jsonResponse as json } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'TTS não configurado: defina OPENAI_API_KEY' }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const g = await gateProAI(env, request, body, { endpoint: 'tts', limit: 10 });
  if (g instanceof Response) return g;

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
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) {
      const err = (await r.text()).slice(0, 300);
      console.warn('tts OpenAI error', r.status, err);
      return json({ error: 'TTS indisponível — tente de novo em instantes' }, 502);
    }
    const audio = await r.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' }
    });
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) return json({ error: 'OpenAI TTS timeout (30s) — tente de novo' }, 504);
    console.warn('tts: exception', e && e.message || e);
    return json({ error: 'Erro interno — tente de novo em instantes' }, 500);
  }
}
