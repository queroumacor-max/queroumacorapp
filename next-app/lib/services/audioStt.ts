// audioStt.ts — service layer pra "Gravação de áudio → Transcrição".
// Porta o subset relevante de modules/audio-stt.js do vanilla:
//   - transcribeAudio: empacota o Blob em multipart/form-data, POSTa em
//     /api/transcribe (Whisper via Cloudflare Function) e retorna o texto.
//
// Decisões:
//  - O hook `useAudioRecording` cuida do MediaRecorder + getUserMedia +
//    timer. Este service é puro request/response, então é trivial mockar
//    em vitest (sem precisar simular Media API).
//  - Não engole erros: a UI decide UX (toast + retry). Vanilla fazia toast
//    direto via global; aqui throw é o contrato.
//  - `language` default 'pt' — o backend (Whisper) usa esse hint pra
//    melhorar accuracy. Mantemos opcional caso outras features (chat,
//    orçamento) queiram outro idioma.

import { NetworkError, ValidationError } from '@/lib/errors';

// Tipo INLINE — entrada do transcribeAudio. Mantemos só os fields que o
// backend Whisper aceita; extensão futura (prompt, temperature) entraria
// como opcional sem quebrar callers.
export interface TranscribeOptions {
  language?: string;
  // Nome do arquivo enviado pro multipart. Default 'note.webm' (igual ao
  // vanilla iniciarGravacaoNota linha 67). Útil sobrescrever pra debug ou
  // pra alinhar com a extensão real do mimeType do MediaRecorder.
  filename?: string;
}

// Resposta esperada do /api/transcribe. `text` é o único required; outros
// fields são metadata (modelo usado, duração).
interface TranscribeResponse {
  text?: string;
  language?: string;
  duration?: number;
  error?: string;
}

/**
 * Transcreve um Blob de áudio via /api/transcribe (Whisper). Aceita qualquer
 * mimeType que o backend aceite (webm/ogg/mp4/wav). Retorna o texto bruto.
 *
 * Throws ValidationError se blob ausente ou vazio (defesa em profundidade,
 * o hook já guarda).
 * Throws NetworkError se rede/parse/HTTP falhar — `cause` carrega o original
 * pra log interno.
 */
export async function transcribeAudio(
  blob: Blob,
  options: TranscribeOptions = {},
): Promise<string> {
  if (!blob) throw new ValidationError('Áudio obrigatório');
  if (typeof blob.size === 'number' && blob.size === 0) {
    throw new ValidationError('Áudio vazio');
  }

  const filename = options.filename || 'note.webm';
  const fd = new FormData();
  fd.append('audio', blob, filename);
  if (options.language) {
    fd.append('language', options.language);
  }

  let res: Response;
  try {
    res = await fetch('/api/transcribe', { method: 'POST', body: fd });
  } catch (e) {
    throw new NetworkError('Falha de rede ao transcrever áudio', e);
  }

  // Backend pode devolver 401/403/429/503 com JSON `{ error: '...' }`.
  // Tenta parsear pra surfar a mensagem real; se não for JSON, usa status.
  let body: TranscribeResponse | null = null;
  try {
    body = (await res.json()) as TranscribeResponse;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const msg = body?.error || `HTTP ${res.status}`;
    throw new NetworkError(msg);
  }

  if (!body || typeof body.text !== 'string' || !body.text.trim()) {
    throw new NetworkError('Resposta inválida do servidor (sem text)');
  }

  return body.text;
}
