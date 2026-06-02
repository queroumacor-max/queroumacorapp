// useSeuZe — hook React que gerencia a thread de chat com o Seu Zé. Espelha
// o estado interno de modules/ai-chat.js (`_aiChatHistory`) + a UX de
// "manda → mostra typing → recebe → renderiza" do vanilla, mas com state
// React puro (não DOM imperativo).
//
// Decisões de design:
//   - Thread vive em useState local. Vanilla mantém o `_aiChatHistory` no
//     escopo do módulo (some quando recarrega a página); replicamos isso com
//     useState — não persistimos em localStorage/Supabase. Quando o usuário
//     sai e volta, começa thread nova. (Pedido explícito do spec.)
//   - useMutation pra `send`: TanStack Query controla pending/error state, e
//     a UI consome via `isSending` / `sendError` sem precisar try/catch.
//   - TTS é opt-in: o hook NÃO chama textToSpeech automaticamente. A UI
//     mostra botão "🔊 Ouvir" em cada msg do assistente; o caller chama
//     speak(messageId) quando o user clica. Evita auto-play indesejado e
//     replica a UX do vanilla.
//   - Voz: o hook integra useVoiceRecorder pra capturar áudio → transcribe →
//     enviar como user message. UI só chama startVoice/stopVoice.
//   - History no payload do backend: passa SEM a typing indicator e SEM a
//     última msg do user (que ainda não foi confirmada como turno completo).
//     Truncado via trimHistory pra MAX_HISTORY.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  sendChatMessage,
  transcribeAudio,
  textToSpeech,
  trimHistory,
  type ChatMessage,
} from '@/lib/services/aiChat';
import { useVoiceRecorder } from '@/lib/hooks/useVoiceRecorder';
import { errMsg } from '@/lib/utils';

// ThreadMessage é o que a UI consome — adiciona id estável (pra React key) e
// flag de "speaking" (pra UI mostrar spinner no botão de ouvir enquanto o
// fetch do TTS roda).
export interface ThreadMessage extends ChatMessage {
  id: string;
}

export interface UseSeuZeResult {
  // Thread (mensagens já renderizadas — não inclui typing indicator).
  messages: ThreadMessage[];
  // Última msg de "user" sendo processada (typing indicator do assistente).
  isSending: boolean;
  sendError: Error | null;
  // Manda uma msg de texto. Adiciona user msg → roda mutation → adiciona reply.
  send: (text: string) => void;
  // Limpa a thread (botão "nova conversa").
  reset: () => void;

  // ── Voz ────────────────────────────────────────────────────────────────
  isRecording: boolean;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  isTranscribing: boolean;
  voiceError: string | null;
  isVoiceSupported: boolean;

  // ── TTS opt-in ─────────────────────────────────────────────────────────
  speak: (messageId: string) => Promise<void>;
  // ID da msg sendo "tocada" (UI pode mostrar spinner / botão "parar").
  speakingId: string | null;
  stopSpeaking: () => void;
  // Auto-fala a resposta do Seu Zé assim que chega (persiste em localStorage).
  autoSpeak: boolean;
  setAutoSpeak: (v: boolean) => void;
}

const AUTO_SPEAK_KEY = 'seuze:autoSpeak';
function readAutoSpeak(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(AUTO_SPEAK_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

// Gerador de id estável e curto pra cada msg. Date.now+rand basta — não
// precisa de uuid (não persiste, é só pra React key).
function nextId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useSeuZe(): UseSeuZeResult {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeakState] = useState<boolean>(() => readAutoSpeak());

  const setAutoSpeak = useCallback((v: boolean) => {
    setAutoSpeakState(v);
    try {
      window.localStorage.setItem(AUTO_SPEAK_KEY, v ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  // Audio HTMLElement vive em ref — não dispara re-render quando troca de URL.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // URL atual sendo tocada (pra revoke quando trocar).
  const audioUrlRef = useRef<string | null>(null);
  // IDs já auto-falados pra não repetir quando o array re-monta.
  const autoSpokenRef = useRef<Set<string>>(new Set());

  // Stop completo de qualquer reprodução em andamento. Idempotente.
  const stopSpeaking = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
      } catch {
        // ignore
      }
    }
    if (audioUrlRef.current) {
      try {
        URL.revokeObjectURL(audioUrlRef.current);
      } catch {
        // ignore
      }
      audioUrlRef.current = null;
    }
    audioRef.current = null;
    setSpeakingId(null);
  }, []);

  // Mutation de envio de texto. Recebe `text` e cuida do fluxo todo:
  // (1) push da user msg → (2) chama service → (3) push do reply.
  // O history passado ao backend é o array de mensagens ATUAL (antes do push
  // da user msg nova) — mesma semântica do vanilla.
  const sendMutation = useMutation<
    { reply: string; userMsg: ThreadMessage; assistantMsg: ThreadMessage },
    Error,
    string
  >({
    mutationFn: async (text: string) => {
      const userMsg: ThreadMessage = { id: nextId(), role: 'user', content: text };
      // Snapshot do history (sem a msg nova) — vai pro backend e pro state.
      const historyForApi = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Otimisticamente adiciona user msg ANTES do fetch — o caller já vê o
      // texto na thread enquanto o typing aparece.
      setMessages((prev) => [...prev, userMsg]);

      const reply = await sendChatMessage(historyForApi, text);
      const assistantMsg: ThreadMessage = {
        id: nextId(),
        role: 'assistant',
        content: reply,
      };
      return { reply, userMsg, assistantMsg };
    },
    onSuccess: ({ assistantMsg }) => {
      setMessages((prev) => trimHistoryWithIds([...prev, assistantMsg]));
    },
    onError: () => {
      // User msg já foi adicionada otimisticamente. Não removemos — UX é
      // "vejo minha pergunta + erro embaixo" em vez de "minha pergunta sumiu".
      // sendError fica disponível pra UI mostrar inline.
    },
  });

  const send = useCallback(
    (text: string) => {
      const t = String(text || '').trim();
      if (!t) return;
      sendMutation.mutate(t);
    },
    [sendMutation]
  );

  const reset = useCallback(() => {
    stopSpeaking();
    setMessages([]);
    sendMutation.reset();
  }, [sendMutation, stopSpeaking]);

  // Voz: integra useVoiceRecorder + transcribe. Quando o blob fica pronto,
  // transcrevemos e chamamos send() com o texto resultante.
  const handleVoiceBlob = useCallback(
    async (blob: Blob) => {
      setIsTranscribing(true);
      setVoiceError(null);
      try {
        const text = await transcribeAudio(blob);
        // Reusa o mesmo fluxo de envio de texto.
        sendMutation.mutate(text);
      } catch (e) {
        const msg = errMsg(e) || 'Erro ao transcrever áudio';
        setVoiceError(msg);
      } finally {
        setIsTranscribing(false);
      }
    },
    [sendMutation]
  );

  const recorder = useVoiceRecorder({
    onComplete: handleVoiceBlob,
    onError: (msg) => setVoiceError(msg),
  });

  // TTS opt-in: chamado pelo botão "🔊 Ouvir" de uma msg específica.
  // Se já está tocando essa msg, faz toggle (para). Se está tocando outra,
  // troca. Pega o conteúdo da msg do state atual via lookup pelo id.
  const speak = useCallback(
    async (messageId: string) => {
      if (speakingId === messageId) {
        stopSpeaking();
        return;
      }
      stopSpeaking(); // mata qualquer reprodução anterior

      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;

      setSpeakingId(messageId);
      try {
        const url = await textToSpeech(msg.content);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (audioUrlRef.current) {
            try {
              URL.revokeObjectURL(audioUrlRef.current);
            } catch {
              // ignore
            }
            audioUrlRef.current = null;
          }
          setSpeakingId(null);
        };
        audio.onerror = () => {
          stopSpeaking();
        };
        await audio.play();
      } catch {
        stopSpeaking();
      }
    },
    [messages, speakingId, stopSpeaking]
  );

  // Auto-fala a última mensagem do assistant quando chega. Trigger só uma
  // vez por id (autoSpokenRef). Respeita o toggle autoSpeak (default ON).
  useEffect(() => {
    if (!autoSpeak) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (autoSpokenRef.current.has(last.id)) return;
    autoSpokenRef.current.add(last.id);
    void speak(last.id);
  }, [messages, autoSpeak, speak]);

  return {
    messages,
    isSending: sendMutation.isPending,
    sendError: sendMutation.error ?? null,
    send,
    reset,

    isRecording: recorder.isRecording,
    startVoice: recorder.start,
    stopVoice: recorder.stop,
    isTranscribing,
    voiceError,
    isVoiceSupported: recorder.isSupported,

    speak,
    speakingId,
    stopSpeaking,
    autoSpeak,
    setAutoSpeak,
  };
}

// Trim com IDs: equivalente a trimHistory mas preservando os ids únicos das
// ThreadMessage. Mantém last MAX_HISTORY entries.
function trimHistoryWithIds(msgs: ThreadMessage[]): ThreadMessage[] {
  const plain = msgs.map((m) => ({ role: m.role, content: m.content }));
  const trimmed = trimHistory(plain);
  // Se nada foi cortado, devolve original (preserva referências React).
  if (trimmed.length === msgs.length) return msgs;
  // Senão, devolve as últimas N (mesma quantidade) com seus ids originais.
  return msgs.slice(-trimmed.length);
}
