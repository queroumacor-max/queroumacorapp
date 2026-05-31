// MessageComposer — input de texto + attachment + voice. Guards de double-
// submit (mutation.isPending) garantem que clicks/Enter rápidos não enviam
// duas vezes (vanilla usava dataset._loading; aqui é state declarativo).
//
// Voice recording (audio webm via MediaRecorder) é um nice-to-have — se a
// API não estiver disponível, o botão fica disabled.

'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useUploadAttachment } from '@/lib/hooks/useChat';
import { ALLOWED_ATTACHMENT_MIMES } from '@/lib/services/chat';

export interface MessageComposerProps {
  sending: boolean;
  disabled?: boolean;
  errorMessage?: string | null;
  onSendText: (text: string) => void;
  onSendAttachment: (file: File) => void;
}

export function MessageComposer({
  sending,
  disabled,
  errorMessage,
  onSendText,
  onSendAttachment,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { uploading } = useUploadAttachment();

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    if (sending || disabled) return;
    onSendText(trimmed);
    setText('');
  }

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (f) onSendAttachment(f);
    // Reset pra permitir mesma seleção de arquivo novamente.
    e.target.value = '';
  }

  const acceptAttr = ALLOWED_ATTACHMENT_MIMES.join(',');
  const busy = sending || uploading;

  return (
    <div className="border-t border-[color:var(--color-border,#e5e5e5)] bg-white p-3">
      {errorMessage ? (
        <p className="text-xs text-red-600 mb-2" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || disabled}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-[color:var(--color-bg,#f5f5f5)] border border-[color:var(--color-border,#e5e5e5)] flex items-center justify-center text-lg disabled:opacity-40"
          aria-label="Anexar arquivo"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptAttr}
          onChange={handlePickFile}
          className="hidden"
          aria-label="Selecionar arquivo para enviar"
        />

        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mensagem..."
          disabled={busy || disabled}
          className="flex-1 px-3 py-2 rounded-full border border-[color:var(--color-border,#e5e5e5)] text-sm focus:outline-none focus:border-[color:var(--color-p1,#ff6a00)] disabled:opacity-50"
          aria-label="Texto da mensagem"
        />

        <button
          type="submit"
          disabled={busy || disabled || !text.trim()}
          className="flex-shrink-0 px-4 h-10 rounded-full bg-[color:var(--color-p1,#ff6a00)] text-white font-semibold text-sm disabled:opacity-40"
        >
          {sending ? '...' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
