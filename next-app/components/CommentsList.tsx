// CommentsList — lista de comentários de um post. Lê via useComments hook
// (já com cache TanStack), renderiza cada comentário com nome do autor
// (não-hidratado por default — caller passa nameByUserId map se quiser
// resolver) e botão de delete pro dono/post-owner.
//
// Decisões:
//   - Não fazemos JOIN com profiles aqui (caller injeta map ou usa apenas
//     user_id). Isso mantém o componente puro e evita N+1 fetches.
//   - Botão "×" só aparece pra (a) dono do comment, (b) dono do post
//     (mesma regra das RLS policies); validação real fica no banco.
//   - Estados loading/empty/error com mensagens em PT, sem skeleton fancy.

'use client';

import { useAuth } from '@/components/AuthProvider';
import { useComments } from '@/lib/hooks/usePostInteractions';

export interface CommentsListProps {
  postId: string;
  /** ID do dono do post — usado pra decidir se o user pode deletar comments alheios. */
  postOwnerId?: string | null;
  /** Map user_id → nome de display (caller faz o batch fetch separadamente). */
  nameByUserId?: Record<string, string>;
  /** Fallback quando o nome não está no map. Default: "Usuário". */
  fallbackName?: string;
}

export function CommentsList({
  postId,
  postOwnerId,
  nameByUserId,
  fallbackName = 'Usuário',
}: CommentsListProps) {
  const { user } = useAuth();
  const { comments, loading, error, remove, isRemoving } = useComments(postId);

  if (loading) {
    return (
      <div className="px-3 py-2 text-sm text-[color:var(--color-muted,#777)]">
        Carregando comentários…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-sm text-red-600" role="alert">
        Erro ao carregar comentários: {error.message}
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-[color:var(--color-muted,#777)]">
        Nenhum comentário ainda.
      </div>
    );
  }

  return (
    <ul className="px-3 py-2 space-y-2" aria-label="Lista de comentários">
      {comments.map((c) => {
        const canDelete = !!user && (user.id === c.user_id || user.id === postOwnerId);
        const displayName = nameByUserId?.[c.user_id] ?? fallbackName;
        return (
          <li
            key={c.id}
            className="flex items-start gap-2 text-sm text-[color:var(--color-ink,#222)]"
            data-comment-id={c.id}
          >
            <span className="flex-1">
              <strong>{displayName}</strong> {c.text}
            </span>
            {canDelete ? (
              <button
                type="button"
                onClick={() => remove(c.id).catch(() => {})}
                disabled={isRemoving}
                aria-label="Apagar comentário"
                title="Apagar"
                className="text-[color:var(--color-muted,#777)] text-base px-1 disabled:opacity-50"
              >
                ×
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
