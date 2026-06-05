// useStories — hook React que centraliza fetch + cache dos grupos de stories
// via TanStack Query, mais a mutation pra marcar grupo como visto.
//
// Substitui o trio vanilla (modules/stories.js: loadStories +
// markStoryGroupSeen + isStoryGroupSeen) por shape declarativo:
//   - useQuery: agrupamento + ordenação já vem feito pelo service;
//   - staleTime 30s pra não bater no banco a cada re-render durante navegação;
//   - mutation `markSeen` invalida a queryKey pra que o anel "visto" atualize
//     em todos os consumers (carousel + qualquer indicador na nav).
//
// `followingIds` entra como parâmetro (caller passa do useFollows / similar)
// em vez do hook puxar follows sozinho — separa concerns: este hook só lê
// stories, não conhece o grafo social.

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchStoriesGroupedByUser,
  markStorySeen,
  type StoryGroup,
} from '@/lib/services/stories';

export interface UseStoriesResult {
  groups: StoryGroup[];
  loading: boolean;
  error: Error | null;
  markSeen: (params: { ownerId: string; lastStoryId?: string }) => void;
  isMarking: boolean;
}

export function useStories(followingIds: string[]): UseStoriesResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // queryKey inclui o array de followingIds (estabilizado pela ordem que o
  // caller passa) — se o usuário seguir/desseguir outra pessoa, o caller
  // re-renderiza com novo array e a query refetch. Inclui user.id pra isolar
  // cache entre sessões diferentes.
  const query = useQuery<StoryGroup[], Error>({
    queryKey: ['stories', user?.id, [...followingIds].sort().join(',')],
    queryFn: () => fetchStoriesGroupedByUser(user!.id, followingIds),
    enabled: !!user,
    // staleTime 2min — useGlobalRealtime invalida em INSERT de posts (stories
    // são posts media_type=story); novo story aparece via realtime.
    staleTime: 2 * 60_000,
  });

  const markSeenMutation = useMutation<
    void,
    Error,
    { ownerId: string; lastStoryId?: string }
  >({
    mutationFn: ({ ownerId, lastStoryId }) =>
      markStorySeen(user!.id, ownerId, lastStoryId),
    onSuccess: () => {
      // Invalida só a entry desta sessão — outras sessões (caso o useStories
      // seja montado com followingIds diferente) refetch sozinhas quando
      // a janela virar.
      qc.invalidateQueries({ queryKey: ['stories', user?.id] });
    },
  });

  return {
    groups: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    markSeen: markSeenMutation.mutate,
    isMarking: markSeenMutation.isPending,
  };
}
