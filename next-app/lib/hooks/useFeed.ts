// useFeed — hook React que centraliza a leitura da timeline principal via
// TanStack `useInfiniteQuery`. Substitui o duo vanilla (loadFeed +
// loadMoreFeed do modules/feed.js) num shape declarativo onde:
//   - cada "página" é um fetch de `FEED_PAGE_SIZE` posts via offset/limit;
//   - `getNextPageParam` decide se tem próxima página (página completa =
//     provavelmente tem mais; página parcial = fim do feed);
//   - o componente chama `fetchNextPage()` quando o sentinel entra em vista
//     (IntersectionObserver no FeedView), sem callback global como o
//     `loadMoreFeed(btn)` do vanilla;
//   - queryKey inclui user.id + roleFilter pra isolar caches entre sessões
//     e entre filtros (vanilla refazia a query a cada troca de filtro).
//
// Não invalidamos manualmente quando muda a lista de following — o stale time
// do useFollowing (5min) já cobre o caso comum. Se virar visível, dá pra
// adicionar `useEffect` que invalida o feed quando `followingIds` muda.

'use client';

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchFeed,
  FEED_PAGE_SIZE,
  type FeedPage,
  type FeedPost,
} from '@/lib/services/feed';
import type { UserRole } from '@/lib/types';

export interface UseFeedOptions {
  roleFilter?: UserRole | string | null;
  // followingOnly: true (default) = só posts de quem você segue + você mesmo.
  // false = feed global (não-logado vê isso, ou usuário em modo "descobrir").
  followingOnly?: boolean;
}

export interface UseFeedResult {
  posts: FeedPost[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

export function useFeed(options: UseFeedOptions = {}): UseFeedResult {
  const { user } = useAuth();
  const roleFilter = options.roleFilter ?? null;
  const followingOnly = options.followingOnly ?? true;

  // pageParam = cursor ISO timestamp (created_at do último post da página
  // anterior). null = primeira página (sem cursor, devolve as N mais
  // recentes). Cursor-based dropa offset shift quando posts novos entram
  // entre fetches e é O(log n) em vez de O(n) no Postgres.
  const query = useInfiniteQuery<
    FeedPage,
    Error,
    InfiniteData<FeedPage, string | null>,
    readonly unknown[],
    string | null
  >({
    queryKey: ['feed', user?.id ?? null, roleFilter, followingOnly],
    queryFn: async ({ pageParam, signal }) =>
      fetchFeed({
        userId: user?.id ?? null,
        cursor: pageParam,
        limit: FEED_PAGE_SIZE,
        roleFilter,
        followingOnly,
        // signal cancela fetch quando o componente desmonta ou a query é
        // invalidada — evita race conditions e wastes de banda.
        signal,
      }),
    initialPageParam: null,
    // getNextPageParam: cursor da próxima página = nextCursor da última.
    // Se hasMore=false ou nextCursor=null, retorna undefined → fim do feed.
    getNextPageParam: (lastPage) => {
      if (!lastPage || !lastPage.hasMore || !lastPage.nextCursor) return undefined;
      return lastPage.nextCursor;
    },
    // staleTime: 30s — alinhado com o default do QueryProvider. Feed muda
    // mais rápido que profile/notifications mas 30s evita refetch agressivo
    // quando o usuário sai e volta rapidinho.
    staleTime: 30_000,
  });

  const posts = query.data?.pages.flatMap((p) => p.items) ?? [];

  return {
    posts,
    loading: query.isLoading,
    error: query.error ?? null,
    hasMore: !!query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    },
    refetch: () => {
      query.refetch();
    },
  };
}
