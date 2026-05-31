// useCrm — hook React que centraliza leitura/mutations da feature CRM
// (Reativar Clientes). Espelha o caminho vanilla de modules/crm.js mas
// substitui:
//   - `_crmIntervalMonths` global → useState local (+ persistência via mutation)
//   - `_crmCache` global → useQuery + cache do TanStack
//   - chamadas imperativas pós-mutation (`renderCrm()`) → invalidateQueries
//
// Decisões de cache:
//   - clientes elegíveis: staleTime 30s. Pintor tipicamente abre, age e
//     fecha — dados não mudam tanto durante a sessão, mas refetch a cada
//     30s captura novos jobs/quotes que o pintor acaba de fechar em
//     outra aba.
//   - intervalo do perfil: staleTime 5min. Quase imutável — pintor
//     configura uma vez e esquece.

'use client';

import { useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchEligibleClients,
  fetchFollowupInterval,
  saveFollowupInterval,
  generateDraftMessage,
  saveFollowUp,
  buildWhatsAppUrl,
  type CrmClient,
  type CrmDraftResult,
  type SaveFollowUpInput,
} from '@/lib/services/crm';

export interface UseCrmResult {
  // Lista FILTRADA pelo `intervalMonths` corrente (clientes elegíveis pra
  // contatar). `allClients` traz a lista bruta pra contagem total.
  clients: CrmClient[];
  allClients: CrmClient[];
  loading: boolean;
  error: Error | null;

  intervalMonths: number;
  setIntervalMonths: (n: number) => void;
  savingInterval: boolean;
  intervalError: Error | null;

  generateDraft: (args: {
    clientName: string;
    monthsAgo: number;
    jobType: string;
  }) => Promise<CrmDraftResult>;
  isGenerating: boolean;
  draftError: Error | null;

  logFollowUp: (input: Omit<SaveFollowUpInput, 'painter_id'>) => Promise<void>;
  isLogging: boolean;

  buildWaUrl: (phone: string | null | undefined, message: string) => string | null;
}

export function useCrm(): UseCrmResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // ── Intervalo (persistido) ─────────────────────────────────────────────
  // Carregado do perfil e mantido local. Quando o usuário muda, a UI usa
  // o valor "otimista" imediato; ao clicar Salvar, dispara a mutation.
  const intervalQuery = useQuery<number, Error>({
    queryKey: ['crm', 'interval', user?.id],
    queryFn: () => fetchFollowupInterval(user!.id),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  // Estado local pro input — começa em 12 e é "rehydrated" quando o
  // intervalQuery resolve. useEffect cuida da sincronização inicial.
  // Não usamos useState direto porque queremos que o valor server-side
  // seja autoridade na primeira leitura.
  const intervalMonths = intervalQuery.data ?? 12;

  const intervalMutation = useMutation<void, Error, number>({
    mutationFn: (n: number) => saveFollowupInterval(user!.id, n),
    onSuccess: (_void, n) => {
      // Atualiza o cache otimisticamente — evita refetch enquanto a UI
      // já mostra o valor novo. Próximo staleTime ainda revalida.
      qc.setQueryData<number>(['crm', 'interval', user?.id], n);
    },
  });

  const setIntervalMonths = (n: number): void => {
    intervalMutation.mutate(n);
  };

  // ── Clientes elegíveis ─────────────────────────────────────────────────
  const clientsQuery = useQuery<CrmClient[], Error>({
    queryKey: ['crm', 'clients', user?.id],
    queryFn: () => fetchEligibleClients(user!.id, intervalMonths),
    enabled: !!user,
    staleTime: 30_000,
  });

  // Re-fetch quando intervalMonths muda — não estritamente necessário (a
  // lista bruta não depende do intervalo), mas mantém o contrato simétrico
  // pra quando virar SQL filter no servidor.
  useEffect(() => {
    // No-op por enquanto: filtro vive em memória abaixo. Comentário
    // documenta a decisão pra futuro mantenedor.
  }, [intervalMonths]);

  // Filtro local: clientes com months_since >= intervalMonths são os
  // "elegíveis". Cliente sem last_service_at (months_since === null) fica
  // fora — não temos como decidir se ele virou silêncio.
  const filtered = useMemo(() => {
    const all = clientsQuery.data ?? [];
    return all.filter(
      (c) => c.months_since !== null && c.months_since >= intervalMonths
    );
  }, [clientsQuery.data, intervalMonths]);

  // ── Geração de mensagem (IA) ───────────────────────────────────────────
  // Mutation pra rascunhar mensagem via /api/crm-draft. Não invalida cache —
  // o draft é local ao card, não persiste no servidor.
  const draftMutation = useMutation<
    CrmDraftResult,
    Error,
    { clientName: string; monthsAgo: number; jobType: string }
  >({
    mutationFn: (args) =>
      generateDraftMessage({
        painterName:
          user?.user_metadata?.name ||
          user?.user_metadata?.full_name ||
          '',
        clientName: args.clientName,
        monthsAgo: args.monthsAgo,
        jobType: args.jobType,
      }),
  });

  // Wrapper assíncrono — devolve a Promise pra que o componente possa
  // `await` e renderizar o draft no textarea/modal antes de fechar loading.
  const generateDraft = (args: {
    clientName: string;
    monthsAgo: number;
    jobType: string;
  }): Promise<CrmDraftResult> => draftMutation.mutateAsync(args);

  // ── Log de follow-up ───────────────────────────────────────────────────
  const logMutation = useMutation<void, Error, Omit<SaveFollowUpInput, 'painter_id'>>({
    mutationFn: (input) =>
      saveFollowUp({ ...input, painter_id: user!.id }),
    onSuccess: () => {
      // Não invalida `crm/clients` — log de follow-up não muda o critério
      // de elegibilidade do cliente (last_service_at vem de jobs/quotes).
      // Quando tivermos `follow_ups` na UI (timeline), invalidamos lá.
    },
  });

  const logFollowUp = (
    input: Omit<SaveFollowUpInput, 'painter_id'>
  ): Promise<void> => logMutation.mutateAsync(input);

  return {
    clients: filtered,
    allClients: clientsQuery.data ?? [],
    loading: clientsQuery.isLoading,
    error: clientsQuery.error ?? null,

    intervalMonths,
    setIntervalMonths,
    savingInterval: intervalMutation.isPending,
    intervalError: intervalMutation.error ?? null,

    generateDraft,
    isGenerating: draftMutation.isPending,
    draftError: draftMutation.error ?? null,

    logFollowUp,
    isLogging: logMutation.isPending,

    buildWaUrl: buildWhatsAppUrl,
  };
}
