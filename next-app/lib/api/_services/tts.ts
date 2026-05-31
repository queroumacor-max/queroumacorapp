// lib/api/_services/tts.ts — port de
// `functions/api/_services/tts.js`. OpenAI Text-to-Speech.

import { ServiceError } from '../security';

const TIMEOUT_MS = 30000;

export async function synthesizeSpeech(args: {
  text: unknown;
}): Promise<{ audio: ArrayBuffer }> {
  const clean =
    typeof args.text === 'string' ? args.text.trim().slice(0, 2000) : '';
  if (!clean) throw new ServiceError('text obrigatório', 400);

  const key = process.env.OPENAI_API_KEY;
  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'onyx',
        input: clean,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const err = (await r.text()).slice(0, 300);
      console.warn('tts OpenAI error', r.status, err);
      throw new ServiceError(
        'TTS indisponível — tente de novo em instantes',
        502
      );
    }
    return { audio: await r.arrayBuffer() };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError('OpenAI TTS timeout (30s) — tente de novo', 504);
    }
    console.warn('tts: exception', e instanceof Error ? e.message : e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
}
