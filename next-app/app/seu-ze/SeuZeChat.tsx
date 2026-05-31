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
import { ChatMessage, TypingIndicator } from './ChatMessage';
import { VoiceRecorder } from './VoiceRecorder';

export function SeuZeChat() {
  const { user, loading: authLoading } = useAuth();
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
  } = useSeuZe();

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

  // Gate PRO. Mesmo padrão de CrmList — lê metadata do JWT enquanto a row de
  // profiles não vem por hook próprio.
  const policyUser = {
    id: user.id,
    is_pro: (user.user_metadata?.is_pro as boolean | undefined) ?? false,
    is_admin: (user.user_metadata?.is_admin as boolean | undefined) ?? false,
    role: (user.user_metadata?.role as string | undefined) ?? null,
  };
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
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] transition-colors"
          >
            Limpar
          </button>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
        aria-live="polite"
      >
        {messages.length === 0 && !isSending ? (
          <div className="text-center py-8 text-sm text-[color:var(--color-muted)]">
            <p className="mb-2 text-base">👋 Oi, sou o Seu Zé!</p>
            <p>
              Pergunta o que você quiser sobre tinta, preço, técnica,
              ferramentas ou material.
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
