// SeuZeChat — client component que orquestra a tela /seu-ze. Espelha o
// conteúdo do modal #ai-chat-modal do vanilla (form de input + thread).
//
// Estados:
//   - authLoading → skeleton
//   - !user → CTA login
//   - !isPro → paywall PRO (gate via canSeeProFeature)
//   - default → thread vazia (com saudação) ou thread populada
//
// Layout: card branco com header simples ("Chat com o Seu Zé" + botão "limpar"),
// área scrollável de mensagens com auto-scroll pro final, footer com input
// de texto + botão de voz + botão enviar.
//
// Auto-scroll: useEffect dispara scrollIntoView na última msg cada vez que
// `messages.length` ou `isSending` mudam (pra acompanhar o typing também).

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useSeuZe } from '@/lib/hooks/useSeuZe';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { ChatMessage, TypingIndicator } from './ChatMessage';
import { VoiceRecorder } from './VoiceRecorder';

export function SeuZeChat() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const {
    messages,
    isSending,
    sendError,
    send,
    reset,
    isRecording,
    isTranscribing,
    isVoiceSupported,
    startVoice,
    stopVoice,
    voiceError,
    speak,
    speakingId,
    autoSpeak,
    setAutoSpeak,
    conversationMode,
    setConversationMode,
  } = useSeuZe();

  // Quando o user liga o modo conversa, abre o mic IMEDIATAMENTE pra começar
  // a primeira fala. Sem isso, ele clicava no toggle e ainda tinha que apertar
  // o botão de microfone — não era hands-free.
  async function handleToggleConversation() {
    const next = !conversationMode;
    setConversationMode(next);
    if (next && !isRecording) {
      try { await startVoice(); } catch { /* permissão negada — UI mostra erro */ }
    } else if (!next && isRecording) {
      stopVoice();
    }
  }

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll pro fim sempre que mensagens mudam ou o typing aparece/some.
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
        <div className="text-5xl mb-3" aria-hidden="true">
          🧑‍🎨
        </div>
        <h2 className="font-semibold mb-2">Entre pra falar com o Seu Zé</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          O assistente IA está esperando você logar.
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

  // Gate PRO: usePolicyUser combina profile (banco — fonte verdade) +
  // JWT metadata (fallback). Antes era só JWT, que raramente tem
  // is_pro/portal_access populados.
  if (!canSeeProFeature(policyUser)) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🧑‍🎨
        </div>
        <h2 className="font-bold mb-2 text-[color:var(--color-ink)]">
          Conversar com o Seu Zé é PRO
        </h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4 max-w-md mx-auto">
          Tire dúvidas técnicas, peça sugestão de preço e tire fotos de
          dúvida — tudo respondido pelo Seu Zé.
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
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--color-border)]">
        <h2 className="text-sm font-bold text-[color:var(--color-ink)]">
          Chat com o Seu Zé
        </h2>
        <div className="flex items-center gap-3">
          {/* Modo conversa hands-free: ativa, fala sem clicar, IA responde
              em áudio e abre o mic de novo automaticamente. */}
          {isVoiceSupported ? (
            <button
              type="button"
              onClick={handleToggleConversation}
              aria-pressed={conversationMode}
              aria-label={conversationMode ? 'Sair do modo conversa' : 'Modo conversa hands-free'}
              title={conversationMode ? 'Modo conversa ON — toque pra sair' : 'Conversa contínua sem precisar clicar'}
              className="text-base hover:scale-110 transition-transform font-bold"
              style={{
                color: conversationMode ? 'var(--color-p1)' : 'var(--color-muted)',
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
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] transition-colors"
            >
              Limpar
            </button>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
        aria-live="polite"
      >
        {messages.length === 0 && !isSending ? (
          <div
            className="text-center py-6 px-4"
            style={{
              background: 'linear-gradient(135deg, rgba(255,107,53,.06), rgba(131,56,236,.06))',
              borderRadius: 16,
              border: '1px solid var(--color-border)',
              margin: '8px 0',
            }}
          >
            <div className="text-4xl mb-2" aria-hidden="true">☕</div>
            <p
              className="font-extrabold mb-1"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 17,
                color: 'var(--color-ink)',
              }}
            >
              Opa, colega! Sou o Seu Zé 🐻
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--color-ink)', lineHeight: 1.55, marginBottom: 8 }}
            >
              Aceita um café enquanto a gente fala de obra?
            </p>
            <p
              className="text-xs"
              style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}
            >
              Tira dúvida de tinta, preço, técnica ou ferramenta — eu manjo.
              Pode falar ou escrever.
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
          />
        ))}

        {isSending || isTranscribing ? <TypingIndicator /> : null}

        {/* Indicador visual quando o mic está aberto em modo conversa */}
        {conversationMode && isRecording && !isTranscribing && !isSending ? (
          <div
            className="my-2 p-3 rounded-xl flex items-center gap-2 text-sm"
            style={{
              background: 'rgba(255,107,53,.08)',
              border: '1px solid rgba(255,107,53,.25)',
              color: 'var(--color-ink)',
            }}
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-1">
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
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
              fale e pause — eu pego sozinho
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
          placeholder="Pergunte ao Seu Zé…"
          rows={1}
          className="flex-1 resize-none px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)] max-h-32"
          aria-label="Mensagem para o Seu Zé"
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
          className="px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {isSending ? '…' : 'Enviar'}
        </button>
      </form>
    </section>
  );
}
