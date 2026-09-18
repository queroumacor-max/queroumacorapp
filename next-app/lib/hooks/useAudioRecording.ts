// useAudioRecording — wrapper React genérico em torno de MediaRecorder.
// Encapsula o ciclo de vida que `modules/audio-stt.js` fazia imperativamente
// (iniciarGravacaoNota/pararGravacaoNota) num hook reusável que outras
// features (notes, chat de voz, orçamento por áudio) podem consumir sem
// duplicar boilerplate.
//
// Responsabilidades:
//   - getUserMedia({ audio: true }) sob demanda;
//   - MediaRecorder com cleanup de tracks (sem isso o browser deixa o
//     mic indicator ON após o stop — bug visível no vanilla pre-fix);
//   - timer com auto-stop em REC_MAX_MS (5 min);
//   - retorna o Blob final via callback `onStop` (o caller decide o que
//     fazer: transcrever, anexar a um chat, salvar local).
//
// Por que callback em vez de exportar `lastBlob` no state? O caller
// normalmente quer reagir ao stop (ex.: chamar transcribeAudio) sem
// reanimar a UI no efeito. Callback é mais direto, menos re-render.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Default 5 min — bate com REC_MAX_MS do vanilla (modules/audio-stt.js
// linha 15). Caller pode sobrescrever via `maxMs` (ex.: nota rápida 30s).
const DEFAULT_MAX_MS = 5 * 60 * 1000;

// Tipo INLINE — config opcional do hook.
export interface UseAudioRecordingOptions {
  // Callback executado quando a gravação para (manual ou auto-stop).
  // Recebe o Blob final agregado dos chunks do MediaRecorder.
  onStop?: (blob: Blob) => void;
  // Callback de erro (permissão negada, browser sem suporte). Default:
  // console.warn. Caller pode plugar um toast/notify.
  onError?: (error: Error) => void;
  // Tempo máximo de gravação em ms — para auto-stop. Default 5 min.
  maxMs?: number;
  // mimeType pedido ao MediaRecorder. Default: deixa o browser escolher
  // (Chrome/Firefox usam webm/opus). Whisper aceita tudo, então qualquer
  // mimeType funciona. Pra forçar mp4 (iOS Safari), passar 'audio/mp4'.
  mimeType?: string;
}

// Tipo INLINE — shape de retorno. Mantemos paralelo a useState (booleans +
// função) pra que o caller faça destructuring direto sem rename.
export interface UseAudioRecordingResult {
  // Inicia gravação. No-op se já gravando. Resolve quando MediaRecorder
  // entra em estado "recording". Joga via onError em falha de permissão.
  start: () => Promise<void>;
  // Para gravação. No-op se não está gravando. Triggera onStop com o Blob.
  stop: () => void;
  // True enquanto MediaRecorder.state === 'recording'.
  recording: boolean;
  // Segundos decorridos desde o start. Atualiza a cada 250ms.
  elapsedSec: number;
  // True quando o browser não suporta MediaRecorder/getUserMedia.
  // Caller deve mostrar UI alternativa (ex.: upload de arquivo).
  unsupported: boolean;
}

/**
 * Hook genérico de gravação de áudio. Espelha o ciclo do vanilla mas com
 * cleanup garantido (useEffect return + ref) pra evitar leak do MediaStream.
 */
export function useAudioRecording(
  options: UseAudioRecordingOptions = {},
): UseAudioRecordingResult {
  const { onStop, onError, maxMs = DEFAULT_MAX_MS, mimeType } = options;

  // Refs em vez de state pra MediaRecorder + chunks + interval — esses
  // são "internals" que não devem disparar re-render quando mudam. Só
  // expomos `recording` e `elapsedSec` no state pra a UI reagir.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // onStop/onError em ref pra evitar recriar `start`/`stop` a cada render
  // do caller — handlers podem mudar de referência sem invalidar o hook.
  const onStopRef = useRef(onStop);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onStopRef.current = onStop;
    onErrorRef.current = onError;
  }, [onStop, onError]);

  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Detecta suporte uma vez (SSR-safe: typeof window check). Em RSC isso
  // resolve false e a UI pode mostrar placeholder até o client hidratar.
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    // Sincroniza com sistema externo (navigator/MediaRecorder) — não é
    // derivável no render/SSR (comentário acima).
    const supported =
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined';
    setUnsupported(!supported);
  }, []);

  // Helper privado: libera stream + interval + recorder. Idempotente.
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Cleanup no unmount — sem isso, sair da tela enquanto grava deixa
  // o mic indicator ON e o MediaRecorder pendurado (memory leak).
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      // onstop handler (setado em start) chama onStop com o Blob agregado.
      rec.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  }, []);

  /**
   * Entrega o erro a quem pediu — e só cai no console quando NÃO há quem
   * receba. Antes as duas coisas aconteciam sempre (ver P8 acima).
   */
  const avisar = useCallback((err: Error, prefixo?: string) => {
    const handler = onErrorRef.current;
    if (handler) {
      handler(err);
      return;
    }
    console.warn(prefixo ? `${prefixo}: ${err.message}` : err.message);
  }, []);

  const start = useCallback(async () => {
    // No-op se já gravando — evita race de double-click. Mesmo guard do
    // vanilla (não duplicado lá, mas implícito por o botão virar disabled).
    if (recorderRef.current?.state === 'recording') return;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      const err = new Error('Browser sem suporte a getUserMedia');
      // P8 (01/09/2026): era `onErrorRef.current?.(err) ?? console.warn(...)`.
      // Callback `void` sempre devolve undefined, então o `??` NUNCA era
      // curto-circuitado: o warn saía mesmo com o erro já tratado. `??` não
      // serve de fallback pra efeito colateral — só pra valor.
      avisar(err);
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      const err = new Error('Browser sem suporte a MediaRecorder');
      avisar(err);
      return;
    }

    let stream: MediaStream;
    try {
      // Teto de tempo: na WebView uma promessa de getUserMedia pendurada não
      // rejeita nunca (mesma lição do getSession/câmera) — sem isto o botão
      // ficaria "pensando" pra sempre em vez de cair pro gravador nativo.
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise<MediaStream>((_, reject) =>
          setTimeout(() => {
            const e = new Error('Microfone não respondeu');
            e.name = 'TimeoutError';
            reject(e);
          }, 12000),
        ),
      ]);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      avisar(err, 'mic denied');
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      // mimeType é hint: browser pode ignorar e usar o default. Try/catch
      // pra o caso de mimeType inválido (alguns Safaris quebram).
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (e) {
      cleanup();
      const err = e instanceof Error ? e : new Error(String(e));
      avisar(err, 'MediaRecorder init failed');
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const finalMime = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: finalMime });
      // Cleanup ANTES do callback pra que o caller possa iniciar outra
      // gravação no próprio onStop sem race com o stream antigo.
      cleanup();
      setRecording(false);
      setElapsedSec(0);
      try {
        onStopRef.current?.(blob);
      } catch (cbErr) {
        // Não deixa erro no callback derrubar o cleanup feito acima.
        console.warn('useAudioRecording onStop callback error:', cbErr);
      }
    };

    recorder.start();
    startTimeRef.current = Date.now();
    setRecording(true);
    setElapsedSec(0);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedSec(Math.floor(elapsed / 1000));
      // Auto-stop quando bate o teto. Stop dispara onStop → cleanup.
      if (elapsed >= maxMs) stop();
    }, 250);
    // `avisar` é estável (useCallback com deps vazias), mas fica declarado
    // pra o hook não depender desse detalhe de implementação.
  }, [mimeType, maxMs, cleanup, stop, avisar]);

  return { start, stop, recording, elapsedSec, unsupported };
}
