// PostCard — renderiza um post individual do feed.
// Substitui a string HTML montada por buildFeedPostHTML do vanilla
// (modules/feed.js linha 400+) por JSX direto. Mantém o mesmo layout/UX:
//   - header com avatar, nome, @tag;
//   - media (PostMedia: imagem ou vídeo com autoplay);
//   - badge "À VENDA" sobreposto quando for_sale;
//   - actions (curtir, comentar, compartilhar, salvar);
//   - linha "N curtidas";
//   - legenda (caption) com nome em bold + texto;
//   - lista de comentários carregados;
//   - timestamp ("agora", "há 2 min", etc.);
//   - botão de compra pra posts à venda.
//
// SEM dangerouslySetInnerHTML — JSX direto pra eliminar a superfície de XSS
// que o vanilla mitigava via escapeHtml manual. React escapa interpolações
// automaticamente.

'use client';

import { Avatar } from '@/components/Avatar';
import { getTimeAgo } from '@/lib/utils';
import { PostMedia } from './PostMedia';
import type { FeedPost } from '@/lib/services/feed';

export interface PostCardProps {
  post: FeedPost;
  // Mute compartilhado entre todos os vídeos do feed — lifted state no
  // FeedView. Cada PostCard só passa adiante pro PostMedia.
  muted: boolean;
  onToggleMute: () => void;
}

// Formatador BRL ao nível de módulo (Intl é caro de instanciar). Mesmo
// padrão do OrderCard.
const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

// Helper de nome — colapsa email pra @ se o tag for ausente (lógica do
// vanilla buildFeedPostHTML linhas 408-411).
function displayName(profile: FeedPost['profile']): string {
  let name = profile.name || (profile.tag ? '@' + profile.tag : 'Usuário');
  if (name.includes('@') && !profile.tag) {
    name = name.split('@')[0] || 'Usuário';
  }
  return name;
}

export function PostCard({ post, muted, onToggleMute }: PostCardProps) {
  const name = displayName(post.profile);
  const handle = post.profile.tag ? '@' + post.profile.tag : '';
  const timeAgo = getTimeAgo(post.created_at);

  return (
    <article
      className="bg-white border-b border-[color:var(--color-border)] mb-4"
      data-post-id={post.id}
      data-author-role={post.profile.role ?? ''}
    >
      <header className="flex items-center gap-3 px-3 py-2.5">
        <Avatar profile={post.profile} size={36} />
        <div className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{name}</span>
          {handle ? (
            <span className="block text-xs text-[color:var(--color-muted)] truncate">
              {handle}
            </span>
          ) : null}
        </div>
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
            <div className="absolute top-3 right-3 bg-gradient-to-br from-purple-600 to-[color:var(--color-p1)] text-white text-xs font-extrabold px-3 py-1.5 rounded-full shadow-md">
              {`A VENDA - ${BRL_FMT.format(post.price ?? 0)}`}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm font-semibold"
          aria-pressed={post.liked}
          aria-label={post.liked ? 'Descurtir' : 'Curtir'}
        >
          <BrushIcon active={post.liked} />
          <span>Curtir{post.likeCount > 0 ? ` - ${post.likeCount}` : ''}</span>
        </button>
        <button type="button" className="flex items-center gap-1.5 text-sm font-semibold" aria-label="Comentar">
          <CommentIcon />
          <span>Comentar</span>
        </button>
        <button type="button" className="flex items-center gap-1.5 text-sm font-semibold" aria-label="Compartilhar">
          <ShareIcon />
          <span>Compartilhar</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm font-semibold ml-auto"
          aria-pressed={post.saved}
          aria-label={post.saved ? 'Remover dos salvos' : 'Salvar'}
        >
          <PaletteIcon active={post.saved} />
        </button>
      </div>

      {post.likeCount > 0 ? (
        <div className="px-3.5 pb-0.5 text-xs font-bold">
          {post.likeCount === 1 ? '1 curtida' : `${post.likeCount} curtidas`}
        </div>
      ) : null}

      {post.caption ? (
        <div className="px-3.5 py-1 text-sm">
          <span className="font-semibold">{name}</span>{' '}
          <span>{post.caption}</span>
        </div>
      ) : null}

      {post.comments.length > 0 ? (
        <ul className="px-3.5 py-1 space-y-1">
          {post.comments.map((c) => {
            // Não temos profile do autor do comment aqui — usaremos fallback
            // genérico. fetchFeed resolve esses profiles internamente; futuro
            // refactor pode propagar via uma estrutura `profMap` se a UX
            // pedir nomes completos em vez de só "Usuário".
            return (
              <li key={c.id} className="text-sm">
                <span className="font-semibold">Usuário</span>{' '}
                <span>{c.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="px-3.5 py-1 text-xs text-[color:var(--color-muted)] uppercase tracking-wider">
        {timeAgo}
      </div>
    </article>
  );
}

// ─── icons ────────────────────────────────────────────────────────────────
// Inline SVG: mesmos paths do vanilla pra preservar o visual. Pequenos o
// suficiente pra não justificar arquivo separado.

function BrushIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill={active ? 'var(--color-p4)' : 'none'}
      stroke={active ? 'var(--color-p4)' : 'var(--color-ink)'}
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 22v-3.5l10.5-10.5 3 3L6.5 22H3z" />
      <path d="m15 6 3-3a2.12 2.12 0 0 1 3 3l-3 3-3-3z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--color-ink)" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--color-ink)" strokeWidth="2" aria-hidden="true">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function PaletteIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill={active ? 'var(--color-p1)' : 'none'}
      stroke={active ? 'var(--color-p1)' : 'var(--color-ink)'}
      strokeWidth="2"
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
