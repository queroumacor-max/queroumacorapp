// CommentForm — input + botão "Enviar" pra adicionar comentário num post.
// Guard de double-submit replica setButtonLoading do vanilla:
//   - mutation.isPending desabilita o button E o input enquanto in-flight;
//   - Enter no input dispara submit (sem duplicar o handler do button);
//   - texto vazio (trim) → no-op silencioso.

'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useComments } from '@/lib/hooks/usePostInteractions';

export interface CommentFormProps {
  postId: string;
  /** Quando preenchido, o comentário é gravado como resposta a este comment. */
  parentId?: string | null;
  /** Callback opcional chamado após sucesso (parent pode fechar o form, etc). */
  onSuccess?: () => void;
  /** Callback opcional pra toast — service throws NetworkError em falha. */
  onError?: (msg: string) => void;
  placeholder?: string;
}

export function CommentForm({
  postId,
  parentId = null,
  onSuccess,
  onError,
  placeholder = 'Adicionar comentário…',
}: CommentFormProps) {
  const { user } = useAuth();
  const { add, isAdding } = useComments(postId);
  const [text, setText] = useState('');

  const submit = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isAdding) return; // double-submit guard adicional ao disabled.
      try {
        await add(trimmed, parentId);
        setText('');
        onSuccess?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao comentar';
        onError?.(msg);
      }
    },
    [text, isAdding, add, parentId, onSuccess, onError],
  );

  if (!user) {
    // Sem auth, não mostra o form — o caller (PostCard) decide se renderiza
    // um placeholder "faça login pra comentar".
    return null;
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 px-3 py-2 border-t border-[color:var(--color-border)]"
      aria-label="Adicionar comentário"
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={isAdding}
        // Enter já submeta via form; sem keydown listener separado pra evitar
        // o double-fire que motivou o `dataset._loading` do vanilla.
        className="flex-1 border border-[color:var(--color-border)] rounded-full px-3 py-1.5 text-sm bg-[color:var(--color-cream,#fffaf0)] outline-none disabled:opacity-60"
        maxLength={500}
        aria-label="Texto do comentário"
      />
      <button
        type="submit"
        disabled={isAdding || !text.trim()}
        className="bg-[color:var(--color-p1,#2563eb)] text-white rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isAdding ? 'Enviando…' : 'Enviar'}
      </button>
    </form>
  );
}
