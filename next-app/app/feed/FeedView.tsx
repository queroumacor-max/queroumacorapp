// FeedView — client component que orquestra a timeline principal.
// Substitui o trio vanilla (loadFeed + loadMoreFeed + setFeedFilter +
// filterFeedPosts em modules/feed.js) por:
//   - useFeed (TanStack useInfiniteQuery) pra dados + paginação;
//   - state local pra filtro de role (pintor/grafiteiro/automotivo);
//   - IntersectionObserver num sentinel no final pra auto-load (replace do
//     "Ver mais publicações" botão que o vanilla mostrava);
//   - lifted state pra `videoMuted` — todos os PostMedia leem do mesmo
//     state pra paridade com o vanilla (mexer no mute de um vídeo muta
//     todos do feed).
//
// O componente faz UI states explícitos:
//   - authLoading: skeleton enquanto a sessão carrega;
//   - loading inicial: skeleton de N posts;
//   - error: card com botão de retry;
//   - vazio: empty state com call-to-action;
//   - lista: posts + sentinel pra infinite scroll.

'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useFeed } from '@/lib/hooks/useFeed';
import { PostCard } from './PostCard';

type RoleFilter = '' | 'pintor' | 'grafiteiro' | 'automotivo';

interface FilterButton {
  value: RoleFilter;
  label: string;
}

const FILTER_BUTTONS: readonly FilterButton[] = [
  { value: '', label: 'Tudo' },
  { value: 'pintor', label: 'Pintores' },
  { value: 'grafiteiro', label: 'Grafiteiros' },
  { value: 'automotivo', label: 'Automotivo' },
];

function PostSkeleton() {
  return (
    <div className="bg-white border-b border-[color:var(--color-border)] mb-4 animate-pulse">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-9 h-9 rounded-full bg-[color:var(--color-border)]" />
        <div className="flex-1">
          <div className="h-3 w-1/3 bg-[color:var(--color-border)] rounded mb-2" />
          <div className="h-2 w-1/5 bg-[color:var(--color-border)] rounded" />
        </div>
      </div>
      <div className="w-full bg-[color:var(--color-border)]" style={{ aspectRatio: '1 / 1' }} />
      <div className="px-3 py-3">
        <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-2 w-1/3 bg-[color:var(--color-border)] rounded" />
      </div>
    </div>
  );
}

export function FeedView() {
  const { user, loading: authLoading } = useAuth();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('');
  // Default muted=true porque autoplay sem mute é bloqueado em quase todos
  // os browsers desktop/mobile. Mesma decisão do vanilla.
  const [videoMuted, setVideoMuted] = useState(true);

  const { posts, loading, error, hasMore, loadingMore, loadMore, refetch } = useFeed({
    roleFilter,
    // Se não-logado, mostra feed global (followingOnly=false). Logado,
    // followingOnly=true (default do hook, mas explícito aqui pra clareza).
    followingOnly: !!user,
  });

  // IntersectionObserver no sentinel — quando o sentinel entra em vista,
  // dispara loadMore. Sem polling, sem botão. rootMargin 200px pra começar
  // a carregar antes do user chegar no fim (UX mais suave).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && hasMore && !loadingMore) {
            loadMore();
          }
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  // ─── render ─────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div aria-label="Carregando">
        {Array.from({ length: 3 }).map((_, i) => (
          <PostSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 px-3 py-3 overflow-x-auto sticky top-0 bg-white z-10 border-b border-[color:var(--color-border)]">
        {FILTER_BUTTONS.map((f) => {
          const active = roleFilter === f.value;
          return (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setRoleFilter(f.value)}
              className={
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors flex-shrink-0 ' +
                (active
                  ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
                  : 'bg-white text-[color:var(--color-ink)] border-[color:var(--color-border)]')
              }
              aria-pressed={active}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div aria-label="Carregando posts">
          {Array.from({ length: 4 }).map((_, i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-10 px-4 m-3 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
          <p className="text-sm text-[color:var(--color-muted)] mb-4">
            Nao foi possivel carregar o feed.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-5 py-2 bg-[color:var(--color-ink)] text-white rounded-xl font-semibold text-sm"
          >
            Tentar de novo
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 px-4 m-3 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-5xl mb-3" aria-hidden="true">🎨</div>
          <h2 className="font-semibold mb-2">Sem publicacoes por aqui</h2>
          <p className="text-sm text-[color:var(--color-muted)]">
            Siga pintores, grafiteiros e estudios pra ver o trabalho deles no feed.
          </p>
        </div>
      ) : (
        <ul>
          {posts.map((p) => (
            <li key={p.id}>
              <PostCard
                post={p}
                muted={videoMuted}
                onToggleMute={() => setVideoMuted((m) => !m)}
              />
            </li>
          ))}
          <li>
            <div ref={sentinelRef} className="h-10 flex items-center justify-center">
              {loadingMore ? (
                <span className="text-xs text-[color:var(--color-muted)]">Carregando mais...</span>
              ) : !hasMore && posts.length > 0 ? (
                <span className="text-xs text-[color:var(--color-muted)]">Voce chegou ao fim</span>
              ) : null}
            </div>
          </li>
        </ul>
      )}
    </div>
  );
}
