// useLeads — hook React que centraliza leitura/compra de leads (posts em
// venda) via TanStack Query. Espelha o caminho vanilla de modules/leads.js
// (comprarObra), mas o ponto de entrada de UI aqui é a tela /leads, não o
// feed inline com botão "Manifestar interesse".
//
// Substitui a chamada imperativa do vanilla por:
//   - useQuery faz fetch + cache (staleTime 60s — leads não rotacionam tanto
//     a ponto de exigir 30s; alinhar com pedidos);
//   - useMutation cobre o "comprar contato" com invalidação automática da
//     lista quando bem-sucedido (lead some da grid sem reload manual).
//
// Não tem realtime: leads chegam por humanos postando, frequência baixa.
// Usuário sai e volta na tela é suficiente. Plugável depois se virar
// requisito (pattern do useNotifications).

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { fetchLeads, comprarObra } from '@/lib/services/leads';
import type { Lead } from '@/lib/types';

export interface UseLeadsResult {
  leads: Lead[];
  loading: boolean;
  error: Error | null;
  comprar: (postId: string) => void;
  isComprarando: boolean;
  comprarError: Error | null;
}

export function useLeads(): UseLeadsResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // queryKey carrega user.id pra isolar caches entre sessões (consistente
  // com useNotifications/usePedidos). `enabled` desativa quando deslogado.
  const query = useQuery<Lead[], Error>({
    queryKey: ['leads', user?.id],
    queryFn: () => fetchLeads(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  // Mutation de "comprar lead". O service estoura ValidationError/
  // AuthorizationError/NetworkError — propaga pra mutation.error pra UI
  // pintar inline (toast/alert) sem precisar try/catch no componente.
  const comprarMutation = useMutation<{ quoteId: string }, Error, string>({
    mutationFn: (postId: string) => comprarObra(postId, user!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads', user?.id] });
    },
  });

  return {
    leads: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    comprar: comprarMutation.mutate,
    isComprarando: comprarMutation.isPending,
    comprarError: comprarMutation.error ?? null,
  };
}
