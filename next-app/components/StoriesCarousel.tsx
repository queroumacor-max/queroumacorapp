// StoriesCarousel — linha horizontal de avatars com ring (estilo IG).
// Mostra um item por grupo de stories. Ring colorido = unseen, cinza = seen.
// Próprio user aparece sempre primeiro (mesmo sem story, com indicador "+").
//
// Click → abre o StoryViewer no índice do grupo. State do viewer fica neste
// componente (não no hook) porque é UI puramente local — quando o usuário
// fecha o viewer, ninguém mais precisa saber qual grupo estava aberto.
//
// O carousel é puramente client (interação + state). Render do server seria
// possível mas obrigaria a separar avatar+ring estático do click-handler.
// Por simplicidade, é tudo client.

'use client';

import { useMemo, useState } from 'react';
import { useStories } from '@/lib/hooks/useStories';
import type { StoryGroup } from '@/lib/services/stories';
import { StoryViewer } from './StoryViewer';

export interface StoriesCarouselProps {
  followingIds: string[];
}

export function StoriesCarousel({ followingIds }: StoriesCarouselProps) {
  const { groups, loading } = useStories(followingIds);
  const [viewerOpenAt, setViewerOpenAt] = useState<number | null>(null);

  // Memoiza a lista renderizável pra evitar recriar callbacks em cada render.
  const items = useMemo(() => groups, [groups]);

  if (loading && items.length === 0) {
    // Skeleton minimal — 5 círculos cinza pra não causar layout shift quando
    // o fetch terminar e a row "expandir".
    return (
      <div className="flex gap-3 overflow-x-auto px-3 py-2" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="w-16 h-16 rounded-full bg-[color:var(--color-border)] animate-pulse" />
            <div className="w-12 h-2 rounded bg-[color:var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className="flex gap-3 overflow-x-auto px-3 py-2 scrollbar-none"
        role="list"
        aria-label="Stories"
      >
        {items.map((g, idx) => (
          <StoryAvatar
            key={g.user_id}
            group={g}
            onClick={() => setViewerOpenAt(idx)}
          />
        ))}
      </div>
      {viewerOpenAt !== null ? (
        <StoryViewer
          groups={items}
          initialGroupIndex={viewerOpenAt}
          onClose={() => setViewerOpenAt(null)}
        />
      ) : null}
    </>
  );
}

// ─── Avatar item ───────────────────────────────────────────────────────────

interface StoryAvatarProps {
  group: StoryGroup;
  onClick: () => void;
}

function StoryAvatar({ group, onClick }: StoryAvatarProps) {
  const p = group.profile;
  const displayName = p.tag
    ? '@' + p.tag
    : (p.name || 'User').split(' ')[0] || 'User';
  const avatarSrc =
    p.avatar_url ||
    group.stories[0]?.media_url ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.name || 'U')}`;

  // Ring styling: gradient quando unseen, cinza quando seen. Mesmo gradient
  // do vanilla (var(--p1) → var(--p4) → var(--p5) → var(--p3) → var(--p1)).
  const ringStyle = group.seen
    ? { background: 'rgba(0,0,0,0.15)' }
    : {
        background:
          'conic-gradient(var(--color-p1, #ff6b3d), var(--color-p4, #ffd93d), var(--color-p5, #6bcf7f), var(--color-p3, #4d96ff), var(--color-p1, #ff6b3d))',
      };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)] rounded-lg p-1"
      aria-label={`Abrir stories de ${displayName}`}
      role="listitem"
    >
      <div
        className="w-16 h-16 rounded-full p-[2px] flex items-center justify-center"
        style={ringStyle}
      >
        <div className="w-full h-full rounded-full bg-white p-[2px] flex items-center justify-center overflow-hidden">
          {/* next/image precisaria de allowlist; usamos img nativa */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarSrc}
            alt=""
            className="w-full h-full rounded-full object-cover"
            loading="lazy"
          />
        </div>
      </div>
      <span className="text-[11px] text-[color:var(--color-ink)] max-w-[64px] truncate">
        {displayName}
      </span>
    </button>
  );
}
