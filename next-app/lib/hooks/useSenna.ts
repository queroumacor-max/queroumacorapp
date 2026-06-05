// useSenna — clone do useSeuZe com 3 mudanças cirúrgicas:
//   1. Storage prefix `senna:` (sessões separadas do Seu Zé)
//   2. Chat endpoint /api/senna (PRO, mesma gate do Seu Zé)
//   3. TTS reusa /api/tts com voice 'alloy' (masculino neutro/técnico)
//
// Resto da mecânica é idêntica: thread de mensagens, modo conversa hands-free,
// histórico de sessões persistido em localStorage, auto-fala, VAD adaptativo.
//
// Optei por clonar em vez de generalizar pra useAiPersona pra manter o Seu Zé
// (em prod) intocado durante o lançamento da Senna. Quando vier 5ª persona,
// fazemos o refactor pra config-driven.

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

export interface ThreadMessage extends ChatMessage {
  id: string;
}

export interface UseSennaResult {
  messages: ThreadMessage[];
  isSending: boolean;
  sendError: Error | null;
  send: (text: string) => void;
  reset: () => void;

  isRecording: boolean;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  isTranscribing: boolean;
  voiceError: string | null;
  isVoiceSupported: boolean;

  speak: (messageId: string) => Promise<void>;
  speakText: (text: string) => Promise<void>;
  speakingId: string | null;
  stopSpeaking: () => void;
  autoSpeak: boolean;
  setAutoSpeak: (v: boolean) => void;

  conversationMode: boolean;
  setConversationMode: (v: boolean) => void;

  sessions: SessionMeta[];
  activeSessionId: string | null;
  newSession: () => void;
  loadSession: (id: string) => void;
  deleteSession: (id: string) => void;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

// Storage keys distintos do Seu Zé pra sessões/preferências não se misturarem.
const AUTO_SPEAK_KEY = 'senna:autoSpeak';
const CONVERSATION_MODE_KEY = 'senna:conversationMode';
const SESSIONS_KEY_PREFIX = 'senna:sessions:';
const ACTIVE_SESSION_KEY_PREFIX = 'senna:activeSession:';
const CHAT_ENDPOINT = '/api/senna';
// Senna é PRO — reusa /api/tts (gateProAI), só troca a voice.
const TTS_ENDPOINT = '/api/tts';
const TTS_VOICE = 'alloy';

const MAX_PERSISTED_MESSAGES = 40;
const MAX_SESSIONS = 15;

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

interface StoredSession extends SessionMeta {
  messages: ThreadMessage[];
}

function readSessions(userId: string | null): StoredSession[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY_PREFIX + userId);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s): s is StoredSession =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as { id?: unknown }).id === 'string' &&
        Array.isArray((s as { messages?: unknown }).messages),
    );
  } catch {
    return [];
  }
}

function writeSessions(userId: string | null, sessions: StoredSession[]): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
    const trimmed = sorted.map((s) => ({
      ...s,
      messages: s.messages.slice(-MAX_PERSISTED_MESSAGES),
    }));
    window.localStorage.setItem(SESSIONS_KEY_PREFIX + userId, JSON.stringify(trimmed));
  } catch { /* quota / private mode */ }
}

function readActiveSessionId(userId: string | null): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_SESSION_KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

function writeActiveSessionId(userId: string | null, sessionId: string | null): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    if (sessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_KEY_PREFIX + userId, sessionId);
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY_PREFIX + userId);
    }
  } catch { /* ignore */ }
}

function deriveTitle(messages: ThreadMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser) {
    const t = firstUser.content.trim().replace(/\s+/g, ' ');
    return t.length > 40 ? t.slice(0, 40) + '…' : t;
  }
  const d = new Date();
  return `Nova conversa · ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function derivePreview(messages: ThreadMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return '';
  const t = last.content.trim().replace(/\s+/g, ' ');
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}

function newSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useSenna(): UseSennaResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [sessions, setSessions] = useState<StoredSession[]>(() => readSessions(userId));
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const persisted = readActiveSessionId(userId);
    if (persisted) return persisted;
    const all = readSessions(userId);
    const sorted = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted[0]?.id ?? null;
  });

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const messages = activeSession?.messages ?? [];

  const setMessages = useCallback(
    (updater: ThreadMessage[] | ((prev: ThreadMessage[]) => ThreadMessage[])) => {
      setSessions((prev) => {
        let activeId = activeSessionId;
        let activeIdx = activeId ? prev.findIndex((s) => s.id === activeId) : -1;
        if (activeIdx < 0) {
          const id = newSessionId();
          const now = Date.now();
          const newSess: StoredSession = {
            id,
            title: 'Nova conversa',
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            preview: '',
            messages: [],
          };
          activeId = id;
          activeIdx = prev.length;
          prev = [...prev, newSess];
          setActiveSessionId(id);
        }
        const cur = prev[activeIdx];
        const nextMsgs =
          typeof updater === 'function'
            ? (updater as (m: ThreadMessage[]) => ThreadMessage[])(cur.messages)
            : updater;
        const updated: StoredSession = {
          ...cur,
          messages: nextMsgs,
          messageCount: nextMsgs.length,
          updatedAt: Date.now(),
          title: cur.title === 'Nova conversa' || !cur.title
            ? deriveTitle(nextMsgs)
            : cur.title,
          preview: derivePreview(nextMsgs),
        };
        const next = [...prev];
        next[activeIdx] = updated;
        return next;
      });
    },
    [activeSessionId],
  );

  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const hydratedForUserRef = useRef<string | null>(userId);
  useEffect(() => {
    if (hydratedForUserRef.current === userId) return;
    hydratedForUserRef.current = userId;
    setSessions(readSessions(userId));
    const persisted = readActiveSessionId(userId);
    if (persisted) {
      setActiveSessionId(persisted);
    } else {
      const all = readSessions(userId);
      const sorted = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
      setActiveSessionId(sorted[0]?.id ?? null);
    }
  }, [userId]);

  useEffect(() => {
    writeSessions(userId, sessions);
  }, [userId, sessions]);

  useEffect(() => {
    writeActiveSessionId(userId, activeSessionId);
  }, [userId, activeSessionId]);

  const [autoSpeak, setAutoSpeakState] = useState<boolean>(() => readAutoSpeak());
  const [conversationMode, setConversationModeState] = useState<boolean>(
    () => readBoolFlag(CONVERSATION_MODE_KEY, false),
  );

  const setAutoSpeak = useCallback((v: boolean) => {
    setAutoSpeakState(v);
    writeBoolFlag(AUTO_SPEAK_KEY, v);
  }, []);

  const setConversationMode = useCallback((v: boolean) => {
    setConversationModeState(v);
    writeBoolFlag(CONVERSATION_MODE_KEY, v);
    if (v && !autoSpeak) {
      setAutoSpeakState(true);
      writeBoolFlag(AUTO_SPEAK_KEY, true);
    }
  }, [autoSpeak]);

  const conversationModeRef = useRef(conversationMode);
  conversationModeRef.current = conversationMode;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const autoSpokenRef = useRef<Set<string>>(new Set());

  const stopSpeaking = useCallback(() => {
    const a = audioRef.current;
    if (a) { try { a.pause(); } catch { /* ignore */ } }
    if (audioUrlRef.current) {
      try { URL.revokeObjectURL(audioUrlRef.current); } catch { /* ignore */ }
      audioUrlRef.current = null;
    }
    audioRef.current = null;
    setSpeakingId(null);
  }, []);

  const sendMutation = useMutation<
    { reply: string; userMsg: ThreadMessage; assistantMsg: ThreadMessage },
    Error,
    string
  >({
    mutationFn: async (text: string) => {
      const userMsg: ThreadMessage = { id: nextId(), role: 'user', content: text };
      const historyForApi = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      setMessages((prev) => [...prev, userMsg]);
      const reply = await sendChatMessage(historyForApi, text, undefined, {
        endpoint: CHAT_ENDPOINT,
      });
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
    setSessions([]);
    setActiveSessionId(null);
    sendMutation.reset();
  }, [sendMutation, stopSpeaking]);

  const newSession = useCallback(() => {
    stopSpeaking();
    const id = newSessionId();
    const now = Date.now();
    const newSess: StoredSession = {
      id,
      title: 'Nova conversa',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      preview: '',
      messages: [],
    };
    setSessions((prev) => [...prev, newSess]);
    setActiveSessionId(id);
    sendMutation.reset();
  }, [sendMutation, stopSpeaking]);

  const loadSession = useCallback(
    (id: string) => {
      stopSpeaking();
      setActiveSessionId(id);
      sendMutation.reset();
    },
    [sendMutation, stopSpeaking],
  );

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === activeSessionId) {
        setSessions((prev) => {
          const sorted = [...prev].sort((a, b) => b.updatedAt - a.updatedAt);
          setActiveSessionId(sorted[0]?.id ?? null);
          return prev;
        });
      }
    },
    [activeSessionId],
  );

  const handleVoiceBlob = useCallback(
    async (blob: Blob) => {
      setIsTranscribing(true);
      setVoiceError(null);
      try {
        const text = await transcribeAudio(blob);
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
    silenceMs: conversationMode ? 900 : 0,
  });

  const startVoiceRef = useRef(recorder.start);
  startVoiceRef.current = recorder.start;

  const speak = useCallback(
    async (messageId: string) => {
      if (speakingId === messageId) {
        stopSpeaking();
        return;
      }
      stopSpeaking();
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      setSpeakingId(messageId);
      try {
        const url = await textToSpeech(msg.content, undefined, {
          endpoint: TTS_ENDPOINT,
          voice: TTS_VOICE,
        });
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (audioUrlRef.current) {
            try { URL.revokeObjectURL(audioUrlRef.current); } catch { /* ignore */ }
            audioUrlRef.current = null;
          }
          setSpeakingId(null);
          if (conversationModeRef.current) {
            setTimeout(() => {
              void startVoiceRef.current().catch(() => { /* permissão negada */ });
            }, 250);
          }
        };
        audio.onerror = () => { stopSpeaking(); };
        await audio.play();
      } catch {
        stopSpeaking();
      }
    },
    [messages, speakingId, stopSpeaking]
  );

  const speakText = useCallback(
    async (text: string) => {
      const clean = (text || '').trim();
      if (!clean) return;
      stopSpeaking();
      setSpeakingId('__intro__');
      try {
        const url = await textToSpeech(clean, undefined, {
          endpoint: TTS_ENDPOINT,
          voice: TTS_VOICE,
        });
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (audioUrlRef.current) {
            try { URL.revokeObjectURL(audioUrlRef.current); } catch { /* ignore */ }
            audioUrlRef.current = null;
          }
          setSpeakingId(null);
        };
        audio.onerror = () => { stopSpeaking(); };
        await audio.play();
      } catch {
        stopSpeaking();
      }
    },
    [stopSpeaking],
  );

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
    speakText,
    speakingId,
    stopSpeaking,
    autoSpeak,
    setAutoSpeak,
    conversationMode,
    setConversationMode,

    sessions: sessions
      .map(({ messages: _msgs, ...meta }) => meta as SessionMeta)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    activeSessionId,
    newSession,
    loadSession,
    deleteSession,
  };
}

function trimHistoryWithIds(msgs: ThreadMessage[]): ThreadMessage[] {
  const plain = msgs.map((m) => ({ role: m.role, content: m.content }));
  const trimmed = trimHistory(plain);
  if (trimmed.length === msgs.length) return msgs;
  return msgs.slice(-trimmed.length);
}
