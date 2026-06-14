// useFollow — hook React de seguir/deixar de seguir com optimistic UI.
// Antes existia só DB.follows.follow/unfollow no /lib/db.ts mas nenhum hook
// mutation — botão "Seguir" ficava esperando o round-trip (~500ms a 2s),
// dando lag visível. Agora flip instantâneo + realtime do useGlobalRealtime
// reconcilia se outro device segue/deixa de seguir em paralelo.
//
// Padrão alinhado com useLike: useQuery pra is_following + useMutation
// com onMutate otimista + rollback em onError.

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { DB } from '@/lib/db';

export interface UseFollowResult {
  isFollowing: boolean;
  isLoading: boolean;
  toggle: () => void;
  isToggling: boolean;
  error: Error | null;
}

export function useFollow(targetId: string): UseFollowResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';
  const key = ['follow-state', targetId, userId];

  const query = useQuery<boolean, Error>({
    queryKey: key,
    queryFn: () => DB.follows.isFollowing(userId, targetId),
    enabled: !!userId && !!targetId && userId !== targetId,
    staleTime: 30_000,
  });

  const isFollowing = query.data ?? false;

  const mutation = useMutation<void, Error, void, { previous: boolean }>({
    mutationFn: async () => {
      if (!userId) throw new Error('Não autenticado');
      if (userId === targetId) throw new Error('Não pode seguir a si mesmo');
      const cur = qc.getQueryData<boolean>(key) ?? false;
      const result = cur
        ? await DB.follows.unfollow(userId, targetId)
        : await DB.follows.follow(userId, targetId);
      if (!result.ok) {
        throw new Error(result.message || 'Falha ao atualizar follow');
      }
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<boolean>(key) ?? false;
      // Flip otimista — botão responde na hora.
      qc.setQueryData<boolean>(key, !previous);
      // Invalida contadores (a UI lê de profile.followers_count ou similar).
      qc.invalidateQueries({ queryKey: ['profile', targetId] });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      // Refetch garante consistência com o banco (em caso de race com
      // outra aba ou trigger AFTER INSERT do banco).
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['following-ids', userId] });
      // Counters desnormalizados: alvo (followers_count) + eu (following_count).
      qc.invalidateQueries({ queryKey: ['profile', targetId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
      // E4: suggest_to_follow exclui quem já é seguido. Quando o user
      // segue alguém da lista de sugestões, a próxima abertura deve
      // recalcular pra não mostrar o mesmo perfil de novo.
      qc.invalidateQueries({ queryKey: ['suggestions', userId] });
    },
  });

  return {
    isFollowing,
    isLoading: query.isLoading,
    toggle: () => mutation.mutate(),
    isToggling: mutation.isPending,
    error: mutation.error ?? null,
  };
}
