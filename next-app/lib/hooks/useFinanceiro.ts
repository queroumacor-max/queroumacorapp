// useFinanceiro — hook React que centraliza leitura/escrita/análise da
// feature "Financeiro" via TanStack Query. Espelha o caminho vanilla de
// modules/financeiro.js (loadFinanceiro + salvarFinEntry + deleteFinEntry +
// analisarFinanceiroIA), mas com state management declarativo:
//   - useQuery faz cache + revalidação (staleTime 60s — financeiro não muda
//     a cada segundo; alinhado com pedidos/leads);
//   - useMutation cobre create/delete/analyze, com invalidação da query
//     quando faz sentido (lista some/repõe automaticamente);
//   - `placeholderData: keepPreviousData` preserva o último resultado
//     enquanto refetch roda — espelha o pattern "não vira R$ —" do vanilla
//     (modules/financeiro.js linha 14-16: header/cards numéricos ficam com
//     o valor anterior durante reload pra evitar flicker).
//
// Sem realtime: jobs mudam por ação humana (lançar, completar projeto),
// frequência baixa. Pintor sai e volta na tela é suficiente.

'use client';

import { useMemo } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchEntries,
  createEntry,
  deleteEntry,
  getMonthSummary,
  analyzeWithAI,
  type FinEntryInput,
  type MonthSummary,
  type AIAnalysisResult,
} from '@/lib/services/financeiro';
import type { Job } from '@/lib/types';

const THIS_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_MONTH_CUTOFF_MS = 60 * 24 * 60 * 60 * 1000;

export interface UseFinanceiroResult {
  /** Todas as entradas no período carregado (default 6 meses). */
  entries: Job[];
  /** Agregado do período inteiro carregado — base dos cards KPI. */
  summary: MonthSummary;
  loading: boolean;
  /** True só durante o primeiro fetch — refetches mantêm `entries` populado
   *  (placeholderData: keepPreviousData) pra UI não piscar "R$ —". */
  isFetching: boolean;
  error: Error | null;

  /** Adiciona lançamento. */
  create: (input: FinEntryInput) => void;
  isCreating: boolean;
  createError: Error | null;

  /** Apaga lançamento. */
  remove: (entryId: string) => void;
  isRemoving: boolean;
  removeError: Error | null;

  /** Dispara análise IA dos últimos 30d vs 30d anteriores (PRO). */
  analyze: () => void;
  isAnalyzing: boolean;
  analysis: AIAnalysisResult | null;
  analyzeError: Error | null;
  resetAnalysis: () => void;
}

export function useFinanceiro(monthsBack = 6): UseFinanceiroResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // queryKey carrega user.id pra isolar caches entre sessões e monthsBack
  // pra que mudar a janela force refetch (vs servir cache antigo). `enabled`
  // desliga quando deslogado pra não bater no fetchEntries (que tem guarda
  // mas evita ruído de query "loading" infinito).
  const query = useQuery<Job[], Error>({
    queryKey: ['financeiro', user?.id, monthsBack],
    queryFn: () => fetchEntries(user!.id, monthsBack),
    enabled: !!user,
    staleTime: 60_000,
    // Mantém os entries anteriores visíveis durante refetch — pattern do
    // vanilla onde os cards KPI ficavam com valor antigo (sem virar "R$ —")
    // enquanto a nova consulta rodava. Evita flicker da UI inteira.
    placeholderData: keepPreviousData,
  });

  // Summary derivado em memória — sem query separada porque já temos `entries`
  // e a soma é O(n) com n ≤ 500. useMemo evita recálculo a cada render quando
  // a tela re-renderiza por mudança upstream (auth, theme) sem mexer na lista.
  const summary = useMemo(
    () => getMonthSummary(query.data ?? []),
    [query.data]
  );

  // Mutations: o service estoura ValidationError/NetworkError — propagamos
  // pra mutation.error e a UI pinta inline (toast/alert/banner) sem precisar
  // try/catch espalhado no componente.

  const createMutation = useMutation<Job, Error, FinEntryInput>({
    mutationFn: (input) => createEntry(user!.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financeiro', user?.id] });
    },
  });

  const removeMutation = useMutation<void, Error, string>({
    mutationFn: (entryId) => deleteEntry(entryId, user!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financeiro', user?.id] });
    },
  });

  // Análise IA: agrega ÚLTIMOS 30d e [30-60d atrás] em memória a partir do
  // que já carregamos. Se monthsBack >= 2, temos os dados necessários sem
  // bater no banco de novo. Mesma lógica do vanilla (modules/financeiro.js
  // linhas 139-156) mas separada do fetch pra simplificar testing.
  const analyzeMutation = useMutation<AIAnalysisResult, Error, void>({
    mutationFn: async () => {
      const now = Date.now();
      const all = query.data ?? [];
      const inThis: Job[] = [];
      const inLast: Job[] = [];
      for (const j of all) {
        const t = j.created_at ? new Date(j.created_at).getTime() : 0;
        if (!t) continue;
        if (t >= now - THIS_MONTH_MS) inThis.push(j);
        else if (t >= now - LAST_MONTH_CUTOFF_MS) inLast.push(j);
      }
      // recentJobs: top 8 do mês atual, payload enxuto pra IA (só os
      // campos que ela usa no prompt — sem id/created_at/notes).
      const recentJobs = inThis.slice(0, 8).map((j) => ({
        service_type: j.service_type || 'Projeto',
        revenue: Number(j.revenue) || 0,
        material_cost: Number(j.material_cost) || 0,
      }));
      return analyzeWithAI({
        thisMonth: getMonthSummary(inThis),
        lastMonth: getMonthSummary(inLast),
        recentJobs,
      });
    },
  });

  return {
    entries: query.data ?? [],
    summary,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,

    create: createMutation.mutate,
    isCreating: createMutation.isPending,
    createError: createMutation.error ?? null,

    remove: removeMutation.mutate,
    isRemoving: removeMutation.isPending,
    removeError: removeMutation.error ?? null,

    analyze: () => analyzeMutation.mutate(),
    isAnalyzing: analyzeMutation.isPending,
    analysis: analyzeMutation.data ?? null,
    analyzeError: analyzeMutation.error ?? null,
    resetAnalysis: () => analyzeMutation.reset(),
  };
}
