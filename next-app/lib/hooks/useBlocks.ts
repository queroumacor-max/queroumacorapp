// useBlocks — TanStack Query wrappers pros blocks service. Inclui:
//   - useBlockedList: lista enriquecida (pra tela /perfil/bloqueados)
//   - useBlockedIds: só os ids (pra cliente filtrar feed/notif)
//   - useBlockMutations: blockUser + unblockUser com invalidate dos 2

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  blockUser,
  unblockUser,
  listBlocked,
  listBlockedIds,
  type BlockedRow,
} from '@/lib/services/blocks';

export function useBlockedList() {
  const { user } = useAuth();
  return useQuery<BlockedRow[], Error>({
    queryKey: ['blocks-list', user?.id],
    queryFn: () => listBlocked(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}

export function useBlockedIds() {
  const { user } = useAuth();
  return useQuery<string[], Error>({
    queryKey: ['blocks-ids', user?.id],
    queryFn: () => listBlockedIds(),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}

export function useBlockMutations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';

  const blockMut = useMutation<void, Error, string>({
    mutationFn: (blockedId: string) => blockUser(userId, blockedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocks-list', userId] });
      qc.invalidateQueries({ queryKey: ['blocks-ids', userId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['notifications', userId] });
      // E4: suggest_to_follow exclui blocked no servidor, então o user
      // recém-bloqueado precisa sumir da lista de sugestões na hora.
      qc.invalidateQueries({ queryKey: ['suggestions', userId] });
    },
  });

  const unblockMut = useMutation<void, Error, string>({
    mutationFn: (blockedId: string) => unblockUser(userId, blockedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocks-list', userId] });
      qc.invalidateQueries({ queryKey: ['blocks-ids', userId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['suggestions', userId] });
    },
  });

  return {
    block: blockMut.mutateAsync,
    unblock: unblockMut.mutateAsync,
    isBlocking: blockMut.isPending,
    isUnblocking: unblockMut.isPending,
  };
}
