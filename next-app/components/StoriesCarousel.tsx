// StoriesCarousel — linha horizontal de avatars com ring (estilo IG).
// Vanilla mantém o fundo dark (var(--ink)) + sempre mostra "Seu story" como
// primeiro item (mesmo sem stories) com botão "+" pra o usuário criar.
// Replicamos a mesma estrutura aqui.
//
// Click → abre o StoryViewer no índice do grupo. State do viewer fica neste
// componente (não no hook) porque é UI puramente local.

'use client';

import { useMemo, useState } from 'react';
import { useStories } from '@/lib/hooks/useStories';
import { useAuth } from '@/components/AuthProvider';
import type { StoryGroup } from '@/lib/services/stories';
import { StoryViewer } from './StoryViewer';

export interface StoriesCarouselProps {
  followingIds: string[];
}

export function StoriesCarousel({ followingIds }: StoriesCarouselProps) {
  const { groups, loading } = useStories(followingIds);
  const { user } = useAuth();
  const [viewerOpenAt, setViewerOpenAt] = useState<number | null>(null);

  const items = useMemo(() => groups, [groups]);
  // O usuário já tem story próprio publicado? Se sim, vira o 1º grupo;
  // senão, mostramos o "Seu story" com o ícone "+" pra criar.
  const ownStoryIdx = user
    ? items.findIndex((g) => g.user_id === user.id)
    : -1;
  const hasOwnStory = ownStoryIdx >= 0;

  return (
    <>
      <div
        className="flex gap-3 overflow-x-auto overflow-y-hidden px-3 py-2.5 scrollbar-none"
        role="list"
        aria-label="Stories"
        style={{
          background: 'var(--color-ink)',
          borderBottom: '1px solid rgba(255,255,255,.07)',
        }}
      >
        {/* "Seu story" — sempre o primeiro, replica vanilla. */}
        <SelfStoryAvatar
          hasOwnStory={hasOwnStory}
          onClick={() =>
            hasOwnStory ? setViewerOpenAt(ownStoryIdx) : null /* TODO: abrir publisher */
          }
        />

        {/* Skeleton se carregando e ainda sem dados. */}
        {loading && items.length === 0 && (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className="w-16 h-16 rounded-full bg-white/10 animate-pulse" />
                <div className="w-12 h-2 rounded bg-white/10 animate-pulse" />
              </div>
            ))}
          </>
        )}

        {/* Stories de seguidos — pula o próprio (já tá como "Seu story").
            Grupos sem story (followingId que não publicou) viram bolinha
            cinza com link pro perfil em vez de abrir o viewer. */}
        {items.map((g, idx) =>
          g.user_id === user?.id ? null : (
            <StoryAvatar
              key={g.user_id}
              group={g}
              onClick={() => {
                if (g.stories.length === 0) {
                  window.location.href = `/perfil/${g.user_id}`;
                } else {
                  setViewerOpenAt(idx);
                }
              }}
            />
          )
        )}
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

// ─── "Seu story" item (próprio user) ───────────────────────────────────────

interface SelfStoryAvatarProps {
  hasOwnStory: boolean;
  onClick: () => void;
}

function SelfStoryAvatar({ hasOwnStory, onClick }: SelfStoryAvatarProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 flex-shrink-0 focus:outline-none rounded-lg p-1"
      aria-label={hasOwnStory ? 'Abrir seu story' : 'Criar story'}
      role="listitem"
    >
      <div
        className="relative w-16 h-16 rounded-full p-[2px] flex items-center justify-center"
        style={{
          background: hasOwnStory
            ? 'conic-gradient(var(--color-p1), var(--color-p2), var(--color-p3), var(--color-p1))'
            : 'rgba(255,255,255,.2)',
        }}
      >
        <div
          className="w-full h-full rounded-full flex items-center justify-center overflow-hidden"
          style={{ background: 'var(--color-ink)', border: '2px solid var(--color-ink)' }}
        >
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
          </svg>
        </div>
        {/* badge "+" no canto inferior direito (estilo IG) */}
        {!hasOwnStory && (
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[color:var(--color-p1)] flex items-center justify-center"
            style={{ border: '2px solid var(--color-ink)' }}
          >
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
        )}
      </div>
      <span className="text-[11px] text-white/85 max-w-[64px] truncate">
        Seu story
      </span>
    </button>
  );
}

// ─── Avatar de outro usuário (story seguindo) ──────────────────────────────

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

  // Anel: gradient colorido quando o grupo tem story não-visto; cinza quando
  // já visto OU quando o seguido não publicou nenhum story (`stories.length === 0`).
  const hasUnseenStory = !group.seen && group.stories.length > 0;
  const ringStyle = hasUnseenStory
    ? {
        background:
          'conic-gradient(var(--color-p1), var(--color-p2), var(--color-p3), var(--color-p4), var(--color-p1))',
      }
    : { background: 'rgba(255,255,255,0.2)' };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 flex-shrink-0 focus:outline-none rounded-lg p-1"
      aria-label={`Abrir stories de ${displayName}`}
      role="listitem"
    >
      <div
        className="w-16 h-16 rounded-full p-[2px] flex items-center justify-center"
        style={ringStyle}
      >
        <div
          className="w-full h-full rounded-full flex items-center justify-center overflow-hidden"
          style={{ background: 'var(--color-ink)', border: '2px solid var(--color-ink)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarSrc}
            alt=""
            className="w-full h-full rounded-full object-cover"
            loading="lazy"
          />
        </div>
      </div>
      <span className="text-[11px] text-white/85 max-w-[64px] truncate">
        {displayName}
      </span>
    </button>
  );
}
