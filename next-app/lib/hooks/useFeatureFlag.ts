// useFeatureFlag — hooks pra resolver feature flags via TanStack Query.
// Espelha o padrão de useProfile/useNotifications.
//
// Dois hooks:
//   - `useFeatureFlag(key)` — resolve UMA flag pra o usuário logado.
//     Usa o RPC `is_feature_enabled` do banco (determinístico, mesmo
//     hash em todas as plataformas).
//   - `useAllFlags()` — lista todas as flags (admin UI). staleTime maior
//     porque flags raramente mudam; o admin força refetch via mutation.
//
// staleTime = 5min: flags são gating de feature — atualização lenta é
// aceitável (e melhor que martelar Supabase a cada mount). Quando o admin
// muda uma flag, o mutate-on-success do `useUpdateFlag` invalida o cache.

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchFlags,
  isFlagEnabled,
  updateFlag,
  type FeatureFlag,
  type FeatureFlagPatch,
} from '@/lib/services/featureFlags';

const FLAG_STALE_MS = 5 * 60 * 1000; // 5min — flags raramente mudam

export interface UseFeatureFlagResult {
  enabled: boolean;
  loading: boolean;
  error: Error | null;
}

/**
 * Resolve UMA flag pra o usuário logado (ou anon se sem sessão).
 * `enabled` default `false` enquanto carrega — preferimos esconder feature
 * por 1 frame do que mostrar e esconder.
 */
export function useFeatureFlag(key: string): UseFeatureFlagResult {
  const { user } = useAuth();
  const query = useQuery<boolean, Error>({
    queryKey: ['featureFlag', key, user?.id ?? null],
    queryFn: () => isFlagEnabled(key, user?.id),
    enabled: !!key,
    staleTime: FLAG_STALE_MS,
  });
  return {
    enabled: query.data === true,
    loading: query.isLoading,
    error: query.error ?? null,
  };
}

export interface UseAllFlagsResult {
  flags: FeatureFlag[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  update: (args: { key: string; patch: FeatureFlagPatch }) => Promise<void>;
  isUpdating: boolean;
  updateError: Error | null;
}

/**
 * Lista todas as flags + mutation de update. Usado SÓ na admin UI
 * (`/admin/flags`). RLS no banco já barra leitura de coluna sensível
 * pra não-admin, então não duplicamos check aqui.
 */
export function useAllFlags(): UseAllFlagsResult {
  const qc = useQueryClient();

  const query = useQuery<FeatureFlag[], Error>({
    queryKey: ['featureFlags', 'all'],
    queryFn: fetchFlags,
    staleTime: FLAG_STALE_MS,
  });

  const updateMutation = useMutation<
    void,
    Error,
    { key: string; patch: FeatureFlagPatch }
  >({
    mutationFn: ({ key, patch }) => updateFlag(key, patch),
    onSuccess: () => {
      // Invalida tanto a lista quanto o cache por-flag (qualquer rollout
      // mudou) — useFeatureFlag(key) recalcula no próximo render.
      qc.invalidateQueries({ queryKey: ['featureFlags', 'all'] });
      qc.invalidateQueries({ queryKey: ['featureFlag'] });
    },
  });

  return {
    flags: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    refetch: () => {
      qc.invalidateQueries({ queryKey: ['featureFlags', 'all'] });
    },
    update: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error ?? null,
  };
}
