// useFollowing — hook React que centraliza a lista de IDs que o usuário
// autenticado segue. Substitui o trio do vanilla (modules/feed.js):
//   - _followingIdsCache / _followingIdsCacheTime (cache manual 5min);
//   - getFollowingIds();
//   - invalidateFollowingIds().
//
// Pattern alinhado com useNotifications / useProfile / useArchivedConvs:
//   - useQuery com `staleTime: 300_000` (5min) — mesma janela do vanilla;
//   - inclui o próprio user.id no resultado (vanilla também — pra o feed
//     pegar os próprios posts);
//   - retorna `invalidate()` pra os call sites de follow/unfollow chamarem
//     depois das mutations (mantém parity com `invalidateFollowingIds`).

'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { DB } from '@/lib/db';

export interface UseFollowingResult {
  ids: string[];
  loading: boolean;
  error: Error | null;
  invalidate: () => void;
}

// queryKey exportado pra que call sites externos (componente de profile que
// faz follow/unfollow) possam invalidar sem importar o hook inteiro.
export const followingQueryKey = (userId: string | undefined) =>
  ['following-ids', userId] as const;

export function useFollowing(): UseFollowingResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<string[], Error>({
    queryKey: followingQueryKey(user?.id),
    queryFn: async () => {
      if (!user) return [];
      const ids = await DB.follows.listFollowingIds(user.id);
      // Inclui o próprio user — paridade com getFollowingIds vanilla
      // (modules/feed.js linha 226). Sem isso, o feed não mostra os
      // próprios posts.
      return [...ids, user.id];
    },
    enabled: !!user,
    staleTime: 300_000,
  });

  // Wrapper estável — useCallback pra não recriar a função em cada render
  // (evita re-render desnecessário em consumers que recebem `invalidate`
  // como prop ou usam em deps de useEffect).
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: followingQueryKey(user?.id) });
  }, [qc, user?.id]);

  return {
    ids: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    invalidate,
  };
}
