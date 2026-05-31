// @ts-check
// Business logic — transcrição via OpenAI Whisper.
import { ServiceError } from '../_security.js';

const MAX_BYTES = 25 * 1024 * 1024; // Whisper aceita até 25 MB
const TIMEOUT_MS = 60000;

/**
 * @param {{ env: Record<string,string>, audio: File | Blob | null | string }} args
 * @returns {Promise<{ text: string }>}
 */
export async function transcribeAudio({ env, audio }) {
  if (!audio || typeof audio === 'string') throw new ServiceError('audio obrigatório', 400);
  const size = audio.size || 0;
  if (size > MAX_BYTES) throw new ServiceError('Áudio acima de 25 MB', 413);

  const upstream = new FormData();
  upstream.append('file', audio, 'audio.webm');
  upstream.append('model', 'whisper-1');
  upstream.append('language', 'pt');

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.OPENAI_API_KEY },
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 300);
      console.warn('transcribe OpenAI error', r.status, errText);
      throw new ServiceError('Transcrição indisponível — tente de novo em instantes', 502);
    }
    const data = await r.json();
    return { text: (data && data.text) || '' };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) throw new ServiceError('Whisper timeout (60s) — tente um áudio menor', 504);
    console.warn('transcribe: exception', e && e.message || e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
}
