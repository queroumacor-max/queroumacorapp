// @ts-check
// Controller fino — TTS do Seu Zé. POST { text } -> audio/mpeg.
// Business logic em `./_services/tts.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { synthesizeSpeech } from './_services/tts.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY) return json({ error: 'TTS não configurado: defina OPENAI_API_KEY' }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'tts', limit: 10 });
  if (g instanceof Response) return g;
  try {
    const { audio } = await synthesizeSpeech({ env, text: body?.text });
    return new Response(audio, { status: 200, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('tts crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
