// @ts-check
// Business logic — OpenAI TTS (Seu Zé). Devolve { audio: ArrayBuffer }
// pra controller embrulhar em Response com content-type áudio.
import { ServiceError } from '../_security.js';

const TIMEOUT_MS = 30000;

/**
 * @param {{ env: Record<string,string>, text: string }} args
 * @returns {Promise<{ audio: ArrayBuffer }>}
 */
export async function synthesizeSpeech({ env, text }) {
  const clean = typeof text === 'string' ? text.trim().slice(0, 2000) : '';
  if (!clean) throw new ServiceError('text obrigatório', 400);
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
        input: clean,
        response_format: 'mp3'
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) {
      const err = (await r.text()).slice(0, 300);
      console.warn('tts OpenAI error', r.status, err);
      throw new ServiceError('TTS indisponível — tente de novo em instantes', 502);
    }
    return { audio: await r.arrayBuffer() };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) throw new ServiceError('OpenAI TTS timeout (30s) — tente de novo', 504);
    console.warn('tts: exception', e && e.message || e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
}
