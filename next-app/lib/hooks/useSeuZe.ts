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
import { useAuth } from '@/components/AuthProvider';
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

  // Modo conversa hands-free: ao ativar, abre o microfone com VAD; quando o
  // user para de falar (1.5s de silêncio) auto-transcreve e envia. Quando a
  // resposta termina de tocar, abre o mic de novo. Persistido em localStorage.
  conversationMode: boolean;
  setConversationMode: (v: boolean) => void;
}

const AUTO_SPEAK_KEY = 'seuze:autoSpeak';
const CONVERSATION_MODE_KEY = 'seuze:conversationMode';
const THREAD_KEY_PREFIX = 'seuze:thread:'; // + userId
// Cap defensivo: histórico longo demais bloated localStorage E inflate
// tokens enviados pro backend. 40 mensagens (~20 turnos) cobre conversas
// reais; mais antigo é descartado FIFO no load.
const MAX_PERSISTED_MESSAGES = 40;
function readBoolFlag(key: string, defaultVal: boolean): boolean {
  if (typeof window === 'undefined') return defaultVal;
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? defaultVal : v === '1';
  } catch {
    return defaultVal;
  }
}
function writeBoolFlag(key: string, v: boolean): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ }
}
function readAutoSpeak(): boolean {
  return readBoolFlag(AUTO_SPEAK_KEY, true);
}

function readThread(userId: string | null): ThreadMessage[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(THREAD_KEY_PREFIX + userId);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Validação defensiva — descarta entradas malformadas (storage corrompido).
    return arr
      .filter(
        (m): m is ThreadMessage =>
          !!m &&
          typeof m === 'object' &&
          typeof (m as { id?: unknown }).id === 'string' &&
          typeof (m as { role?: unknown }).role === 'string' &&
          typeof (m as { content?: unknown }).content === 'string' &&
          ((m as { role: string }).role === 'user' ||
            (m as { role: string }).role === 'assistant'),
      )
      .slice(-MAX_PERSISTED_MESSAGES);
  } catch {
    return [];
  }
}

function writeThread(userId: string | null, msgs: ThreadMessage[]): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const trimmed = msgs.slice(-MAX_PERSISTED_MESSAGES);
    window.localStorage.setItem(
      THREAD_KEY_PREFIX + userId,
      JSON.stringify(trimmed),
    );
  } catch {
    // Quota exceeded / private mode — sem fallback. Próximo refresh
    // perde mas conversa atual segue normal.
  }
}

function clearThread(userId: string | null): void {
  if (!userId || typeof window === 'undefined') return;
  try { window.localStorage.removeItem(THREAD_KEY_PREFIX + userId); } catch { /* ignore */ }
}

// Gerador de id estável e curto pra cada msg. Date.now+rand basta — não
// precisa de uuid (não persiste, é só pra React key).
function nextId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useSeuZe(): UseSeuZeResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Hidrata thread do localStorage no mount inicial. Por user pra não vazar
  // contexto entre contas no mesmo device.
  const [messages, setMessages] = useState<ThreadMessage[]>(() => readThread(userId));
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // Re-hidrata quando user troca (multi-conta no mesmo device).
  const hydratedForUserRef = useRef<string | null>(userId);
  useEffect(() => {
    if (hydratedForUserRef.current === userId) return;
    hydratedForUserRef.current = userId;
    setMessages(readThread(userId));
  }, [userId]);

  // Persiste a cada mudança. Throttle implícito: setState bate em batch
  // React já agrega múltiplos updates por frame.
  useEffect(() => {
    writeThread(userId, messages);
  }, [userId, messages]);
  const [autoSpeak, setAutoSpeakState] = useState<boolean>(() => readAutoSpeak());
  const [conversationMode, setConversationModeState] = useState<boolean>(
    () => readBoolFlag(CONVERSATION_MODE_KEY, false),
  );

  const setAutoSpeak = useCallback((v: boolean) => {
    setAutoSpeakState(v);
    writeBoolFlag(AUTO_SPEAK_KEY, v);
  }, []);

  // conversationMode liga: autoSpeak também (faz sentido — fluxo hands-free
  // precisa da resposta em áudio pra fechar o loop).
  const setConversationMode = useCallback((v: boolean) => {
    setConversationModeState(v);
    writeBoolFlag(CONVERSATION_MODE_KEY, v);
    if (v && !autoSpeak) {
      setAutoSpeakState(true);
      writeBoolFlag(AUTO_SPEAK_KEY, true);
    }
  }, [autoSpeak]);

  // Ref pro modo conversa — usado dentro de callbacks que não devem re-criar
  // quando o flag muda (ex.: onended do audio TTS).
  const conversationModeRef = useRef(conversationMode);
  conversationModeRef.current = conversationMode;

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
    clearThread(userId);
    sendMutation.reset();
  }, [sendMutation, stopSpeaking, userId]);

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
    // Em modo conversa: VAD de 900ms (silêncio sustentado pós-fala → para
    // sozinho). VAD adaptativo no useVoiceRecorder calibra o threshold no
    // primeiro 500ms baseado no ambiente — 900ms total é responsivo sem
    // cortar quando o user pausa naturalmente entre palavras.
    silenceMs: conversationMode ? 900 : 0,
  });

  // Ref do start do recorder pra uso em callbacks (evita re-criar speak/etc).
  const startVoiceRef = useRef(recorder.start);
  startVoiceRef.current = recorder.start;

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
          // Conversa hands-free: fim do TTS → abre o mic pra próxima fala
          // automaticamente. Delay pequeno (250ms) pra não pegar eco do
          // último frame do speaker.
          if (conversationModeRef.current) {
            setTimeout(() => {
              void startVoiceRef.current().catch(() => {
                // permissão negada/erro — sai do modo silenciosamente
              });
            }, 250);
          }
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
    conversationMode,
    setConversationMode,
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
