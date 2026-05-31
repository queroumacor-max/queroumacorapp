// lib/api/_services/transcribe.ts — port de
// `functions/api/_services/transcribe.js`. Whisper STT.

import { ServiceError } from '../security';

const MAX_BYTES = 25 * 1024 * 1024; // Whisper aceita até 25 MB
const TIMEOUT_MS = 60000;

export async function transcribeAudio(args: {
  audio: File | Blob | FormDataEntryValue | null;
}): Promise<{ text: string }> {
  const audio = args.audio;
  if (!audio || typeof audio === 'string') {
    throw new ServiceError('audio obrigatório', 400);
  }
  const file = audio as File | Blob;
  const size = file.size || 0;
  if (size > MAX_BYTES) throw new ServiceError('Áudio acima de 25 MB', 413);

  const key = process.env.OPENAI_API_KEY;
  const upstream = new FormData();
  upstream.append('file', file, 'audio.webm');
  upstream.append('model', 'whisper-1');
  upstream.append('language', 'pt');

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 300);
      console.warn('transcribe OpenAI error', r.status, errText);
      throw new ServiceError(
        'Transcrição indisponível — tente de novo em instantes',
        502
      );
    }
    const data = (await r.json()) as { text?: string };
    return { text: data?.text || '' };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError(
        'Whisper timeout (60s) — tente um áudio menor',
        504
      );
    }
    console.warn('transcribe: exception', e instanceof Error ? e.message : e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
}
