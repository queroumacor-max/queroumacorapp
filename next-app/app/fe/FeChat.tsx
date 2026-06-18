// FeChat — clone do SeuZeChat com mudanças cirúrgicas pro Fê:
//   - useFe (em vez de useSeuZe)
//   - Gate PRO mantido (grafiteiro é profissional pago)
//   - Avatar próprio (urso grafiteiro com spray e moletom "Fê")
//   - Saudação e copy ajustados pra cena street/grafite
//   - Cor de destaque: laranja-grafite #ff6b35 (mesma do brand)
//
// Quando vier 5ª persona, refatorar todos os PersonaChat em
// AiPersonaChat parametrizado. Por ora, clone explícito mantém cada
// persona isolada de mudanças em outra.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { AiConsentGate } from '@/components/AiConsentGate';
import { useFe } from '@/lib/hooks/useFe';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { ChatMessage, TypingIndicator, type AvatarConfig } from '../seu-ze/ChatMessage';
import { VoiceRecorder } from '../seu-ze/VoiceRecorder';

const FE_AVATAR: AvatarConfig = {
  src: '/img/fe.webp',
  alt: 'Fê',
  typingLabel: 'Fê está digitando',
};

export function FeChat() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const {
    messages,
    isSending,
    sendError,
    send,
    isRecording,
    isTranscribing,
    isVoiceSupported,
    startVoice,
    stopVoice,
    voiceError,
    speak,
    speakText,
    speakingId,
    autoSpeak,
    setAutoSpeak,
    conversationMode,
    setConversationMode,
    sessions,
    activeSessionId,
    newSession,
    loadSession,
    deleteSession,
  } = useFe();

  const [historyOpen, setHistoryOpen] = useState(false);

  // Saudação só na 1ª abertura com thread vazia. Dispara no 1º gesto
  // (autoplay policy do navegador exige user-gesture).
  const greetedRef = useRef(false);
  const greetingArmedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    if (!user) return;
    if (messages.length > 0) { greetingArmedRef.current = false; return; }
    if (!autoSpeak) { greetingArmedRef.current = false; return; }
    greetingArmedRef.current = true;
  }, [user, messages.length, autoSpeak]);

  const fireGreeting = useCallback(() => {
    if (greetedRef.current || !greetingArmedRef.current) return;
    greetedRef.current = true;
    greetingArmedRef.current = false;
    void speakText(
      'Salve, brother! Sou o Fê. Manda a real, qual rolê você tá pensando — tag, mural, character?',
    );
  }, [speakText]);

  async function handleToggleConversation() {
    const next = !conversationMode;
    setConversationMode(next);
    if (next && !isRecording) {
      try { await startVoice(); } catch { /* permissão negada */ }
    } else if (!next && isRecording) {
      stopVoice();
    }
  }

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isSending, isTranscribing]);

  if (authLoading) {
    return (
      <div
        className="bg-white rounded-2xl border border-[color:var(--color-border)] p-8 animate-pulse h-96"
        aria-hidden="true"
      />
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">🎨</div>
        <h2 className="font-semibold mb-2">Entre pra conversar com o Fê</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          O brother da cena tá te esperando — faça login pra começar.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  // Gate PRO: Fê é assistente de grafiteiro profissional (paid).
  if (!canSeeProFeature(policyUser)) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">🎨</div>
        <h2 className="font-bold mb-2 text-[color:var(--color-ink)]">
          Conversar com o Fê é PRO
        </h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4 max-w-md mx-auto">
          Tira dúvida sobre spray, técnica, mural, preço por m² — tudo com
          o Fê.
        </p>
        <Link
          href="/pro"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Ativar PRO
        </Link>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    send(t);
    setInput('');
  }

  function handleVoiceToggle() {
    if (isRecording) {
      stopVoice();
    } else {
      void startVoice();
    }
  }

  return (
    <section
      className="bg-white rounded-2xl border border-[color:var(--color-border)] flex flex-col"
      style={{ height: 'min(70vh, 600px)' }}
      onPointerDownCapture={fireGreeting}
      onKeyDownCapture={fireGreeting}
    >
      <AiConsentGate assistantName="o Fê" />
      <header className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--color-border)]">
        <h2 className="text-sm font-bold text-[color:var(--color-ink)]">
          Chat com o Fê
        </h2>
        <div className="flex items-center gap-3">
          {isVoiceSupported ? (
            <button
              type="button"
              onClick={handleToggleConversation}
              aria-pressed={conversationMode}
              aria-label={conversationMode ? 'Sair do modo conversa' : 'Modo conversa hands-free'}
              title={conversationMode ? 'Modo conversa ON — toque pra sair' : 'Conversa contínua sem precisar clicar'}
              className="text-base hover:scale-110 transition-transform font-bold"
              style={{
                color: conversationMode ? '#ff6b35' : 'var(--color-muted)',
              }}
            >
              {conversationMode ? '🟢' : '⚪'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setAutoSpeak(!autoSpeak)}
            aria-pressed={autoSpeak}
            aria-label={autoSpeak ? 'Desativar fala automática' : 'Ativar fala automática'}
            title={autoSpeak ? 'Fala automática ligada' : 'Fala automática desligada'}
            className="text-base hover:scale-110 transition-transform"
          >
            {autoSpeak ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label="Ver conversas anteriores"
            title="Conversas anteriores"
            className="text-base hover:scale-110 transition-transform relative"
          >
            📜
            {sessions.length > 0 ? (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', top: -4, right: -6,
                  background: '#ff6b35', color: '#fff',
                  fontSize: 9, fontWeight: 800,
                  borderRadius: 999, padding: '1px 5px', lineHeight: 1.2,
                }}
              >
                {sessions.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={newSession}
            aria-label="Nova conversa"
            title="Nova conversa"
            className="text-base hover:scale-110 transition-transform"
          >
            ＋
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
        aria-live="polite"
      >
        {messages.length === 0 && !isSending ? (
          <div
            className="text-center py-5 px-4"
            style={{
              background: 'linear-gradient(135deg, rgba(255,107,53,.06), rgba(255,107,53,.04))',
              borderRadius: 14,
              border: '1px dashed var(--color-border)',
              margin: '8px 0',
            }}
          >
            <p
              className="text-sm"
              style={{ color: 'var(--color-ink)', lineHeight: 1.55, marginBottom: 6, fontWeight: 600 }}
            >
              🎨 Manda o rolê — tag, throw, mural, character
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--color-ink)', lineHeight: 1.55, marginBottom: 8, fontWeight: 600 }}
            >
              🎤 Ou toque no microfone pra falar por voz
            </p>
            <p
              className="text-xs"
              style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}
            >
              Falo de spray, cap, técnica, mural, preço por m² e legalidade — sem rodeio.
            </p>
          </div>
        ) : null}

        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            role={m.role}
            content={m.content}
            isSpeaking={speakingId === m.id}
            onSpeak={m.role === 'assistant' ? () => void speak(m.id) : undefined}
            avatar={FE_AVATAR}
          />
        ))}

        {isSending || isTranscribing ? <TypingIndicator avatar={FE_AVATAR} /> : null}

        {conversationMode && isRecording && !isTranscribing && !isSending ? (
          <div
            className="my-2 p-3 rounded-xl flex items-center gap-2 text-sm"
            style={{
              background: 'rgba(255,107,53,.1)',
              border: '1px solid rgba(255,107,53,.25)',
              color: 'var(--color-ink)',
            }}
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-1">
              <span
                style={{
                  display: 'inline-block',
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#e63946',
                  animation: 'pulse-rec 1s ease-in-out infinite',
                }}
              />
              <style>{`
                @keyframes pulse-rec {
                  0%, 100% { opacity: 1; transform: scale(1); }
                  50% { opacity: 0.4; transform: scale(0.8); }
                }
              `}</style>
            </span>
            <span className="font-bold">Ouvindo…</span>
            <span className="text-xs text-[color:var(--color-muted)]">
              fale e pause — eu pego sozinha
            </span>
          </div>
        ) : null}

        {sendError ? (
          <div
            role="alert"
            className="my-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
          >
            {sendError.message || 'Falha ao enviar.'}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-[color:var(--color-border)] p-3 flex gap-2 items-end"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const t = input.trim();
              if (t) {
                send(t);
                setInput('');
              }
            }
          }}
          placeholder="Pergunte ao Fê…"
          rows={1}
          className="flex-1 resize-none px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-xl focus:outline-none focus:ring-2 max-h-32"
          style={{ ['--tw-ring-color' as never]: '#ff6b35' }}
          aria-label="Mensagem para o Fê"
          disabled={isSending || isTranscribing}
        />
        <VoiceRecorder
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          isSupported={isVoiceSupported}
          error={voiceError}
          onToggle={handleVoiceToggle}
        />
        <button
          type="submit"
          disabled={!input.trim() || isSending || isTranscribing}
          className="px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          style={{ background: '#ff6b35' }}
        >
          {isSending ? '…' : 'Enviar'}
        </button>
      </form>

      {historyOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Conversas anteriores"
          className="fixed inset-0 z-50 flex items-start justify-center"
          style={{ background: 'rgba(0,0,0,.55)', padding: '40px 12px 12px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setHistoryOpen(false); }}
        >
          <div
            className="bg-white shadow-xl flex flex-col"
            style={{
              width: '100%',
              maxWidth: 460,
              maxHeight: 'calc(100vh - 80px)',
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <header
              className="flex items-center justify-between"
              style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}
            >
              <h3 className="font-bold text-sm">
                Conversas anteriores ({sessions.length})
              </h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Fechar"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 ? (
                <p
                  className="text-center"
                  style={{ padding: 32, fontSize: 13, color: 'var(--color-muted)' }}
                >
                  Sem conversas anteriores ainda.
                  <br />
                  Comece falando com o Fê!
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {sessions.map((s) => {
                    const isActive = s.id === activeSessionId;
                    return (
                      <li
                        key={s.id}
                        style={{
                          borderBottom: '1px solid var(--color-border)',
                          background: isActive ? 'rgba(255,107,53,.06)' : '#fff',
                        }}
                      >
                        <div className="flex items-center gap-2" style={{ padding: '12px 16px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              loadSession(s.id);
                              setHistoryOpen(false);
                            }}
                            style={{
                              flex: 1, minWidth: 0, textAlign: 'left',
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            }}
                          >
                            <div
                              className="font-bold truncate"
                              style={{
                                fontSize: 13,
                                color: isActive ? '#ff6b35' : 'var(--color-ink)',
                              }}
                            >
                              {isActive ? '🟢 ' : ''}{s.title || 'Sem título'}
                            </div>
                            {s.preview ? (
                              <div
                                className="truncate"
                                style={{
                                  fontSize: 11, color: 'var(--color-muted)', marginTop: 2,
                                }}
                              >
                                {s.preview}
                              </div>
                            ) : null}
                            <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 3 }}>
                              {new Date(s.updatedAt).toLocaleString('pt-BR', {
                                day: '2-digit', month: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                              })}
                              {' · '}
                              {s.messageCount} {s.messageCount === 1 ? 'msg' : 'msgs'}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSession(s.id)}
                            aria-label="Apagar conversa"
                            title="Apagar"
                            style={{
                              background: 'none', border: 'none',
                              color: 'var(--color-muted)', fontSize: 16,
                              cursor: 'pointer', padding: '4px 8px',
                            }}
                          >
                            🗑️
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer
              className="flex gap-2"
              style={{ padding: 12, borderTop: '1px solid var(--color-border)' }}
            >
              <button
                type="button"
                onClick={() => {
                  newSession();
                  setHistoryOpen(false);
                }}
                className="flex-1 font-bold text-white text-sm"
                style={{
                  padding: 11,
                  background: 'var(--color-ink)',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ＋ Nova conversa
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
