// useVoiceRecorder — wrapper React em volta do MediaRecorder API. Espelha o
// par `aiChatToggleVoice` / `aiChatStopVoice` de modules/ai-chat.js.
//
// Por que hook separado? Permite testar a feature de chat sem precisar mockar
// MediaRecorder no mesmo describe — o useSeuZe só consome o `start/stop` e
// recebe Blob no callback. Testes de service ficam puros (não tocam em
// browser APIs).
//
// Estados expostos:
//   - isRecording: bool — pra UI mudar ícone do botão (mic → stop)
//   - error: string | null — permissão negada, MediaRecorder não suportado
//
// Auto-stop: 60s default (espelha o vanilla linha 168). O `silenceMs` no
// spec original menciona 5s mas o vanilla usa 60s — fixamos 60s pra paridade.
// Pode customizar via opts.
//
// Cleanup: stop dos tracks no unmount + clearTimeout — sem isso o LED do mic
// fica aceso depois que o usuário sai da tela.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from '@/lib/utils';

export interface UseVoiceRecorderOptions {
  // Callback disparado quando a gravação para e o Blob está pronto.
  onComplete: (blob: Blob) => void;
  // Callback opcional pra erros (permissão, hardware). Caller pode mostrar toast.
  onError?: (msg: string) => void;
  // Auto-stop em N ms se o usuário esquecer (default 60_000 = 60s).
  autoStopMs?: number;
  // Auto-stop por SILÊNCIO: para a gravação depois de N ms de silêncio
  // contínuo, MAS só depois que o user falou alguma coisa primeiro.
  // 0 ou undefined = desligado (modo manual: user precisa apertar pra parar).
  // Recomendado: 1200-1800ms (conversa natural).
  silenceMs?: number;
  // Threshold RMS pra considerar "silêncio". 0-1, default 0.015 (~ ambiente
  // calmo). Pra ambientes barulhentos pode subir pra 0.03-0.05.
  silenceThreshold?: number;
}

export interface UseVoiceRecorderResult {
  isRecording: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  // Para a UI consumidora poder checar suporte antes de mostrar o botão.
  isSupported: boolean;
}

const DEFAULT_AUTOSTOP_MS = 60_000;

// Detecção de suporte: precisamos de getUserMedia E MediaRecorder. Em SSR
// (typeof navigator === 'undefined') retorna false sem reclamar.
function detectSupport(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }
  if (typeof MediaRecorder === 'undefined') return false;
  return true;
}

export function useVoiceRecorder(
  opts: UseVoiceRecorderOptions
): UseVoiceRecorderResult {
  const {
    onComplete,
    onError,
    autoStopMs = DEFAULT_AUTOSTOP_MS,
    silenceMs = 0,
    silenceThreshold = 0.015,
  } = opts;

  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs pra recursos que NÃO devem disparar re-render: stream, recorder,
  // chunks acumulados, timeout id.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  // VAD (Voice Activity Detection) — AudioContext + Analyser + RAF loop pra
  // medir nível RMS continuamente e disparar stop após N ms de silêncio
  // contínuo PÓS-fala. Refs porque não deve causar re-render.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceSinceRef = useRef<number>(0);

  // useRef em callbacks pra evitar re-criar start/stop a cada render do
  // componente pai (que recriaria `onComplete` em arrow inline). Os refs
  // sempre apontam pra última versão.
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  // Cleanup geral — usado em stop normal, erro, unmount.
  const cleanup = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch { /* ignore */ }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    hasSpokenRef.current = false;
    silenceSinceRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      try {
        rec.stop();
      } catch {
        // Algumas implementações falham se já parou — silencioso.
      }
    }
    // O `onstop` handler cuida do cleanup + onComplete. Mas se o recorder
    // nunca chegou a iniciar (race), garantimos cleanup aqui.
    if (!rec) cleanup();
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }, [cleanup]);

  const start = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      return; // já gravando
    }
    setError(null);

    if (!detectSupport()) {
      const msg = 'Seu navegador não suporta gravação de áudio';
      setError(msg);
      onErrorRef.current?.(msg);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      const msg = 'Permissão de microfone negada';
      if (isMountedRef.current) setError(msg);
      onErrorRef.current?.(msg);
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch (e) {
      const msg = 'Erro ao iniciar gravação: ' + (errMsg(e) || 'erro');
      cleanup();
      if (isMountedRef.current) setError(msg);
      onErrorRef.current?.(msg);
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = () => {
      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      cleanup();
      if (isMountedRef.current) setIsRecording(false);
      // Dispara mesmo se o componente desmontou — o caller pode ter mecanismo
      // próprio (ex.: salvar em outro lugar). Mas só chamamos se houve som
      // (size > 0) — Blob vazio quebra o backend de transcribe.
      if (blob.size > 0) onCompleteRef.current(blob);
    };

    try {
      recorder.start();
    } catch (e) {
      const msg = 'Erro ao iniciar gravação: ' + (errMsg(e) || 'erro');
      cleanup();
      if (isMountedRef.current) setError(msg);
      onErrorRef.current?.(msg);
      return;
    }

    if (isMountedRef.current) setIsRecording(true);

    // Auto-stop. Em sessão real, evita usuário esquecer microfone aberto.
    if (autoStopMs > 0) {
      autoStopTimerRef.current = setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state === 'recording') {
          stop();
        }
      }, autoStopMs);
    }

    // VAD: liga só se silenceMs > 0. Cria AudioContext + Analyser sobre o
    // mesmo stream do MediaRecorder, mede RMS num loop RAF (~60fps), e para
    // a gravação quando detecta silêncio sustentado DEPOIS que o user falou.
    // Sem o "depois que falou", o stop dispararia no início (antes do user
    // dizer alguma coisa) e nunca grava nada.
    if (silenceMs > 0 && typeof window !== 'undefined') {
      try {
        const AC: typeof AudioContext =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
        if (AC) {
          const ctx = new AC();
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          analyserRef.current = analyser;
          const buf = new Uint8Array(analyser.fftSize);

          const tick = () => {
            const cur = analyserRef.current;
            const rec = recorderRef.current;
            if (!cur || !rec || rec.state !== 'recording') {
              vadRafRef.current = null;
              return;
            }
            cur.getByteTimeDomainData(buf);
            // RMS normalizado em [0, 1]. 128 é o centro (silêncio digital).
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / buf.length);
            const now = Date.now();
            if (rms > silenceThreshold) {
              hasSpokenRef.current = true;
              silenceSinceRef.current = now;
            } else if (hasSpokenRef.current) {
              if (silenceSinceRef.current === 0) silenceSinceRef.current = now;
              if (now - silenceSinceRef.current >= silenceMs) {
                // Silêncio sustentado pós-fala — para a gravação.
                stop();
                return;
              }
            }
            vadRafRef.current = requestAnimationFrame(tick);
          };
          vadRafRef.current = requestAnimationFrame(tick);
        }
      } catch {
        // VAD opcional — se falhar (browser sem AudioContext, etc.),
        // segue só com autoStopMs e stop manual.
      }
    }
  }, [autoStopMs, cleanup, stop, silenceMs, silenceThreshold]);

  // Cleanup no unmount — garante que o mic não fica aceso depois que a tela some.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const rec = recorderRef.current;
      if (rec && rec.state === 'recording') {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
      cleanup();
    };
  }, [cleanup]);

  return {
    isRecording,
    error,
    start,
    stop,
    isSupported: detectSupport(),
  };
}
