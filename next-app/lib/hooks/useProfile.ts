// useProfile — hook React que centraliza leitura/escrita do `profiles` row
// do usuário autenticado via TanStack Query. Espelha o trio vanilla
// (modules/profile-edit.js openEditProfile + saveEditProfile + invalidateMyProfile)
// num shape declarativo.
//
// Padrão alinhado com useNotifications/usePedidos:
//   - useQuery faz cache + revalidação (staleTime 60s — profile não muda
//     com frequência alta; 60s evita refetch a cada navegação interna);
//   - useMutation cobre o update com invalidação automática do cache;
//   - queryKey carrega user.id pra isolar caches entre sessões.

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  getProfile,
  updateProfile,
  type ProfilePatch,
} from '@/lib/services/profile';
import type { Profile } from '@/lib/types';

export interface UseProfileResult {
  profile: Profile | null;
  loading: boolean;
  error: Error | null;
  update: (patch: ProfilePatch) => Promise<void>;
  isUpdating: boolean;
  updateError: Error | null;
}

export function useProfile(): UseProfileResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<Profile | null, Error>({
    queryKey: ['profile', user?.id],
    queryFn: () => getProfile(user!.id),
    enabled: !!user,
    // staleTime curto (10s) — useProfileRealtime invalida o cache em qualquer
    // UPDATE em profiles, então sempre temos dado fresco quando relevante.
    // Os 10s só evitam re-fetch em re-renders próximos (mesma sessão).
    staleTime: 10_000,
    // Refetch sempre que a aba volta a ter foco (default true, explícito
    // pra deixar claro).
    refetchOnWindowFocus: true,
  });

  const updateMutation = useMutation<void, Error, ProfilePatch>({
    mutationFn: (patch: ProfilePatch) => updateProfile(user!.id, patch),
    // Otimista: aplica o patch no cache ANTES do round-trip terminar.
    // Sem isso, refresh imediato após save pegava dado antigo do localStorage
    // (a invalidateQueries só refetcha depois — se o user dá F5 no meio,
    // perde os valores recém-salvos visualmente).
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['profile', user?.id] });
      const previous = qc.getQueryData<Profile | null>(['profile', user?.id]);
      qc.setQueryData<Profile | null>(['profile', user?.id], (old) => {
        if (!old) return old;
        return { ...old, ...patch } as Profile;
      });
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      // Rollback se o UPDATE no banco falhar.
      const c = ctx as { previous?: Profile | null } | undefined;
      if (c?.previous !== undefined) {
        qc.setQueryData(['profile', user?.id], c.previous);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
    },
  });

  // mutateAsync expõe a promise — preferimos sobre `mutate` aqui porque o
  // form (RHF) precisa await pra setar `isSubmitting=false` no momento certo
  // e pintar erros inline. mutate (fire-and-forget) deixaria o submit travado.
  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: query.error ?? null,
    update: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error ?? null,
  };
}
