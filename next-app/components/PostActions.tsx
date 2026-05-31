// PostActions — barra horizontal de botões "Curtir / Comentar / Compartilhar
// / Salvar" pra um post. Componente integrável com PostCard (do agent feed):
// é só passar postId e ele cuida do estado via hooks.
//
// Convenções:
//   - Layout flex row, mesmo "shape" visual do vanilla (svg + label "Curtir · N").
//   - Botões usam aria-pressed pra acessibilidade (toggle states).
//   - Share usa Web Share API (`navigator.share`) se disponível, fallback
//     pra clipboard (mesma fallback chain do vanilla copyCurrentPostLink).
//   - onCommentClick é prop opcional — quando provided, abre/fecha um
//     CommentForm controlado pelo parent. Sem prop, o botão vira link visual
//     (ex.: dentro de uma PostDetailPage que sempre mostra comentários).

'use client';

import { useCallback } from 'react';
import { useLike, useSavedPosts } from '@/lib/hooks/usePostInteractions';

export interface PostActionsProps {
  postId: string;
  /** Quando provided, click no botão "Comentar" dispara este callback. */
  onCommentClick?: () => void;
  /** URL canônica do post pra share/copy. Default: `<origin>/?post=<id>`. */
  shareUrl?: string;
  /** Texto compartilhado junto da URL (descrição curta do post). */
  shareText?: string;
  /** Callback opcional pra mostrar toast no app — desacoplado pra reuso. */
  onToast?: (msg: string) => void;
}

// SVG inline pra evitar dependência de icon lib. Tamanho 22 bate com o vanilla.
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function PostActions({
  postId,
  onCommentClick,
  shareUrl,
  shareText,
  onToast,
}: PostActionsProps) {
  const { liked, count, toggle: toggleLike, isPending: likePending } = useLike(postId);
  const { isSaved, toggle: toggleSave, isToggling: savePending } = useSavedPosts();
  const saved = isSaved(postId);

  const handleShare = useCallback(async () => {
    // Default URL — só ativa em browser; SSR não usa esse caminho.
    const url =
      shareUrl ||
      (typeof window !== 'undefined'
        ? `${window.location.origin}/?post=${postId}`
        : '');
    if (!url) return;

    // Web Share API: disponível em mobile Safari/Chrome. Outros fallam pra
    // clipboard. Cancel pelo usuário é silencioso (não estoura toast).
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url, text: shareText });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        // Continua pro fallback se share falhou por outro motivo.
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        onToast?.('Link copiado!');
      } catch {
        onToast?.('Erro ao copiar');
      }
    }
  }, [postId, shareUrl, shareText, onToast]);

  return (
    <div className="flex items-center gap-4 px-3 py-2 border-t border-[color:var(--color-border)]">
      <button
        type="button"
        onClick={toggleLike}
        disabled={likePending}
        aria-pressed={liked}
        aria-label={liked ? 'Descurtir post' : 'Curtir post'}
        className="flex items-center gap-1.5 text-sm font-medium disabled:opacity-60"
        style={{ color: liked ? 'var(--color-p4, #e0245e)' : 'var(--color-ink, #222)' }}
      >
        <HeartIcon filled={liked} />
        <span>{count > 0 ? `Curtir · ${count}` : 'Curtir'}</span>
      </button>

      <button
        type="button"
        onClick={onCommentClick}
        aria-label="Comentar no post"
        className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--color-ink,#222)]"
      >
        <CommentIcon />
        <span>Comentar</span>
      </button>

      <button
        type="button"
        onClick={handleShare}
        aria-label="Compartilhar post"
        className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--color-ink,#222)]"
      >
        <ShareIcon />
        <span>Compartilhar</span>
      </button>

      <button
        type="button"
        onClick={() => toggleSave(postId)}
        disabled={savePending}
        aria-pressed={saved}
        aria-label={saved ? 'Remover dos salvos' : 'Salvar post'}
        className="flex items-center gap-1.5 text-sm font-medium ml-auto disabled:opacity-60"
        style={{ color: saved ? 'var(--color-p1, #2563eb)' : 'var(--color-ink, #222)' }}
      >
        <BookmarkIcon filled={saved} />
        <span>{saved ? 'Salvo' : 'Salvar'}</span>
      </button>
    </div>
  );
}
