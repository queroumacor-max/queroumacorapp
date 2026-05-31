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
import { fetchFeed, FEED_PAGE_SIZE, type FeedPost } from '@/lib/services/feed';
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

  const query = useInfiniteQuery<
    FeedPost[],
    Error,
    InfiniteData<FeedPost[], number>,
    readonly unknown[],
    number
  >({
    queryKey: ['feed', user?.id ?? null, roleFilter, followingOnly],
    queryFn: async ({ pageParam }) =>
      fetchFeed({
        userId: user?.id ?? null,
        offset: pageParam,
        limit: FEED_PAGE_SIZE,
        roleFilter,
        followingOnly,
      }),
    initialPageParam: 0,
    // getNextPageParam: a próxima página começa onde a anterior parou.
    // Se a última retornou MENOS que o page size, chegamos no fim — devolve
    // undefined pra TanStack saber que `hasNextPage` é false.
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < FEED_PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
    // staleTime: 30s — alinhado com o default do QueryProvider. Feed muda
    // mais rápido que profile/notifications mas 30s evita refetch agressivo
    // quando o usuário sai e volta rapidinho.
    staleTime: 30_000,
  });

  const posts = query.data?.pages.flat() ?? [];

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
