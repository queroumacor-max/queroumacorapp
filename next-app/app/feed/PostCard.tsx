// PostCard — renderiza um post individual do feed.
// Espelha EXATO o `buildFeedPostHTML` do vanilla (modules/feed.js linha
// 400+) e o CSS `.mpost*` (styles.css linha 95+):
//   - card branco com border-radius 18px + shadow + margin entre cards;
//   - header com `.av-ring` (gradient conic) envolvendo `.av-inner`
//     (branco) com avatar dentro;
//   - 5 botões de ação (Curtir / Comentar / Compartilhar / Orçar /
//     Salvar). Orçar SÓ aparece se o post NÃO é do user atual. Cada botão
//     com ícone EM CIMA e label EMBAIXO (flex-direction: column);
//   - linha "N curtidas" (oculta se 0);
//   - legenda (caption) com nome em bold;
//   - lista de comentários carregados;
//   - timestamp em uppercase ("AGORA", "HÁ 2 MIN").
//
// Botões Curtir/Salvar usam `useLike`/`useSavedPosts` pra estado real;
// Compartilhar usa Web Share API com fallback pra clipboard; Orçar abre
// chat com o autor pra pedir orçamento.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { CommentForm } from '@/components/CommentForm';
import { useAuth } from '@/components/AuthProvider';
import { useLike, useSavedPosts } from '@/lib/hooks/usePostInteractions';
import { getTimeAgo } from '@/lib/utils';
import { PostMedia } from './PostMedia';
import type { FeedPost } from '@/lib/services/feed';

export interface PostCardProps {
  post: FeedPost;
  muted: boolean;
  onToggleMute: () => void;
}

const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function displayName(profile: FeedPost['profile']): string {
  let name = profile.name || (profile.tag ? '@' + profile.tag : 'Usuário');
  if (name.includes('@') && !profile.tag) {
    name = name.split('@')[0] || 'Usuário';
  }
  return name;
}

export function PostCard({ post, muted, onToggleMute }: PostCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const name = displayName(post.profile);
  const handle = post.profile.tag ? '@' + post.profile.tag : '';
  const timeAgo = getTimeAgo(post.created_at);

  const { liked, count: likeCount, toggle: toggleLike } = useLike(post.id);
  const { isSaved, toggle: toggleSave } = useSavedPosts();
  const saved = isSaved(post.id);
  const [showComment, setShowComment] = useState(false);

  const isOwn = !!user && user.id === post.user_id;

  async function handleShare() {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/?post=${post.id}`
        : '';
    if (!url) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url, text: post.caption ?? '' });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* silent */
      }
    }
  }

  function handleOrcar() {
    router.push(`/chat?to=${encodeURIComponent(post.user_id)}&orcamento=1`);
  }

  return (
    <article
      className="bg-white overflow-hidden mb-3 mx-3"
      data-post-id={post.id}
      data-author-role={post.profile.role ?? ''}
      style={{
        borderRadius: 18,
        boxShadow: '0 2px 12px rgba(0,0,0,.06)',
      }}
    >
      {/* mpost-head — avatar com ring gradient + meta + dots */}
      <header className="flex items-center gap-2.5" style={{ padding: '12px 14px' }}>
        <div
          className="flex-shrink-0"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            padding: 2,
            background:
              'conic-gradient(var(--color-p1), var(--color-p4), var(--color-p5), var(--color-p3), var(--color-p1))',
          }}
        >
          <div
            className="w-full h-full overflow-hidden bg-white"
            style={{ borderRadius: '50%', border: '2px solid #fff' }}
          >
            <Avatar profile={post.profile} size={30} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <span
            className="block truncate"
            style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-ink)' }}
          >
            {name}
          </span>
          {handle ? (
            <span
              className="block truncate"
              style={{ fontSize: 11, color: 'var(--color-muted)' }}
            >
              {handle}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Opções do post"
          className="text-[color:var(--color-muted)]"
          style={{ fontSize: 18, lineHeight: 1, padding: 4 }}
        >
          ···
        </button>
      </header>

      {post.media_url ? (
        <div className="relative w-full">
          <PostMedia
            url={post.media_url}
            mediaType={post.media_type}
            muted={muted}
            onToggleMute={onToggleMute}
          />
          {post.for_sale ? (
            <div
              className="absolute top-3 right-3 text-white font-extrabold"
              style={{
                background:
                  'linear-gradient(135deg, #8338ec, var(--color-p1))',
                fontSize: 11,
                padding: '5px 12px',
                borderRadius: 20,
                boxShadow: '0 2px 8px rgba(0,0,0,.3)',
              }}
            >
              🖼️ À VENDA · {BRL_FMT.format(post.price ?? 0)}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* mpost-actions — 5 botões column layout (ícone acima, label abaixo) */}
      <div
        className="flex items-center"
        style={{ padding: '10px 14px 6px', gap: 10 }}
      >
        <ActionButton
          label={`Curtir${likeCount > 0 ? ` · ${likeCount}` : ''}`}
          onClick={toggleLike}
          ariaLabel={liked ? 'Descurtir' : 'Curtir'}
          ariaPressed={liked}
        >
          <BrushIcon active={liked} />
        </ActionButton>

        <ActionButton
          label="Comentar"
          ariaLabel="Comentar"
          onClick={() => setShowComment((v) => !v)}
        >
          <CommentIcon />
        </ActionButton>

        <ActionButton label="Compartilhar" onClick={handleShare} ariaLabel="Compartilhar">
          <ShareIcon />
        </ActionButton>

        {!isOwn ? (
          <ActionButton label="Orçar" onClick={handleOrcar} ariaLabel="Pedir orçamento">
            <DocIcon />
          </ActionButton>
        ) : null}

        <div className="ml-auto">
          <ActionButton
            label="Salvar"
            onClick={() => toggleSave(post.id)}
            ariaLabel={saved ? 'Remover dos salvos' : 'Salvar'}
            ariaPressed={saved}
          >
            <PaletteIcon active={saved} />
          </ActionButton>
        </div>
      </div>

      {showComment ? (
        <div style={{ padding: '4px 14px 8px' }}>
          <CommentForm
            postId={post.id}
            onSuccess={() => setShowComment(false)}
          />
        </div>
      ) : null}

      {likeCount > 0 ? (
        <div
          style={{
            padding: '0 14px 2px',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--color-ink)',
          }}
        >
          {likeCount === 1 ? '1 curtida' : `${likeCount} curtidas`}
        </div>
      ) : null}

      {post.caption ? (
        <div style={{ fontSize: 13.5, padding: '0 14px 6px', lineHeight: 1.5 }}>
          <b style={{ fontWeight: 600 }}>{name}</b> {post.caption}
        </div>
      ) : null}

      {post.comments.length > 0 ? (
        <ul style={{ padding: '4px 14px 2px' }}>
          {post.comments.map((c) => (
            <li
              key={c.id}
              style={{
                fontSize: 13,
                color: 'var(--color-ink)',
                marginBottom: 4,
              }}
            >
              <b style={{ fontWeight: 600 }}>Usuário</b> {c.text}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        style={{
          padding: '6px 14px 12px',
          fontSize: 10,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
        }}
      >
        {timeAgo}
      </div>
    </article>
  );
}

// ─── action button ────────────────────────────────────────────────────────
// Replica `.act-btn` do vanilla: flex column, ícone em cima, label
// 10px embaixo, min 44x44 pra touch target.

interface ActionButtonProps {
  label: string;
  ariaLabel: string;
  ariaPressed?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

function ActionButton({
  label,
  ariaLabel,
  ariaPressed,
  onClick,
  children,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className="flex flex-col items-center justify-center"
      style={{
        gap: 3,
        padding: '4px 2px',
        minWidth: 44,
        minHeight: 44,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--color-muted)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  );
}

// ─── icons ────────────────────────────────────────────────────────────────
// Inline SVG: paths idênticos ao vanilla pra preservar visual.

function BrushIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill={active ? 'var(--color-p4)' : 'none'}
      stroke={active ? 'var(--color-p4)' : 'var(--color-ink)'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 22v-3.5l10.5-10.5 3 3L6.5 22H3z" />
      <path d="m15 6 3-3a2.12 2.12 0 0 1 3 3l-3 3-3-3z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function PaletteIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill={active ? 'var(--color-p1)' : 'none'}
      stroke={active ? 'var(--color-p1)' : 'var(--color-ink)'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="8" cy="9" r="1.5" fill="var(--color-p4)" stroke="none" />
      <circle cx="15" cy="8" r="1.5" fill="var(--color-p5)" stroke="none" />
      <circle cx="16" cy="13" r="1.5" fill="var(--color-p3)" stroke="none" />
      <circle cx="9" cy="14" r="1.5" fill="var(--color-p1)" stroke="none" />
    </svg>
  );
}
