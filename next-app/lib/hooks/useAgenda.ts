// useAgenda — hook React que centraliza a leitura/escrita da tabela `jobs`
// (calendário de projetos do pintor) via TanStack Query, mais o state local
// pro mês exibido e pro dia selecionado.
//
// Substitui o estado interno do módulo vanilla `modules/agenda.js`:
//   - `_agCur` (Date) → `month` (year/month)
//   - `_agSel` (yyyy-mm-dd) → `selectedDay`
//   - `_agJobs` cache → `data` do useQuery
//
// O fetch é por mês (em vez do dump de 500 do vanilla) — o service já filtra
// `gte/lt` no `scheduled_date`, então cada navegação de mês dispara uma nova
// query com cache isolado pelo queryKey `[..., year, month]`.
//
// Estado UI (month/selectedDay) vive em useState aqui mesmo — não precisa de
// Context porque só a tela /agenda consome. Modal de criar/editar job é state
// local no componente que abre (JobFormModal recebe `open`/`onClose` como
// props), mantendo o hook focado em data fetching.
//
// Não tem realtime por enquanto: jobs mudam quando o pintor cria/atualiza
// manualmente, freq baixa. Invalidação acontece via `onSuccess` das mutations.
// Se virar requisito (sincronizar entre múltiplas abas/devices), o pattern
// é o mesmo do useNotifications: channel `jobs:painter_id`.

'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchJobsByMonth,
  createJob,
  updateJobStatus,
  optimizeDayOrder,
  type OptimizeDayResult,
} from '@/lib/services/agenda';
import type { Job, JobInput, JobStatus } from '@/lib/types';
import { agYmd } from '@/lib/utils';

export interface UseAgendaResult {
  // Dados
  jobs: Job[]; // jobs do mês corrente
  jobsForDay: Job[]; // jobs filtrados do dia selecionado
  countsByDay: Record<string, number>; // 'yyyy-mm-dd' → quantidade (pra dots)

  // Estado de carregamento/erro do fetch do mês
  loading: boolean;
  error: Error | null;

  // Navegação de mês (1-12 humano)
  year: number;
  month: number;
  goToMonth: (delta: number) => void; // -1 = anterior, +1 = próximo

  // Dia selecionado (yyyy-mm-dd) + setter
  selectedDay: string;
  setSelectedDay: (d: string) => void;

  // Mutations
  create: (input: JobInput) => void;
  isCreating: boolean;
  createError: Error | null;

  updateStatus: (args: { jobId: string; status: JobStatus }) => void;
  isUpdatingStatus: boolean;
  updateStatusError: Error | null;

  optimize: () => void;
  isOptimizing: boolean;
  optimizeError: Error | null;
  optimizeResult: OptimizeDayResult | null;
  resetOptimize: () => void;
}

/**
 * Helper interno: extrai `{year, month}` (1-12) de uma Date no fuso local.
 */
function ymOf(d: Date): { year: number; month: number } {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function useAgenda(): UseAgendaResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Inicializa no mês corrente + dia de hoje. useState lazy evita instanciar
  // Date a cada render (só na montagem).
  const [{ year, month }, setYm] = useState(() => ymOf(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(() =>
    agYmd(new Date())
  );

  // queryKey carrega painterId + ano + mês pra isolar cache por sessão E por
  // mês — navegar de Maio→Junho→Maio reusa o cache do Maio sem refetch.
  const query = useQuery<Job[], Error>({
    queryKey: ['agenda', user?.id, year, month],
    queryFn: () => fetchJobsByMonth(user!.id, year, month),
    enabled: !!user,
    staleTime: 60_000,
  });

  const jobs = query.data ?? [];

  // Pré-computa dots por dia em memória — derivado do array de jobs do mês,
  // não vale a pena armazenar em state. Chave 'yyyy-mm-dd' bate com selectedDay.
  const countsByDay = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const j of jobs) {
      if (j.scheduled_date) {
        const k = String(j.scheduled_date).slice(0, 10);
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    return counts;
  }, [jobs]);

  // Lista do dia selecionado, ordenada por scheduled_time (texto livre tipo
  // "14:30" — localeCompare basta porque o formato é estável). Memoiza pra
  // evitar refilter quando outros bits do hook mudam (ex.: mutation flags).
  const jobsForDay = useMemo<Job[]>(() => {
    if (!selectedDay) return [];
    return jobs
      .filter(
        (j) =>
          j.scheduled_date &&
          String(j.scheduled_date).slice(0, 10) === selectedDay
      )
      .sort((a, b) =>
        String(a.scheduled_time || '').localeCompare(
          String(b.scheduled_time || '')
        )
      );
  }, [jobs, selectedDay]);

  /**
   * Navega +/- N meses. Date overflow handles dezembro→janeiro do ano
   * seguinte (e janeiro→dezembro do ano anterior).
   */
  function goToMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYm(ymOf(d));
  }

  // ─── Mutations ────────────────────────────────────────────────────────────
  // Cada uma invalida a queryKey do mês corrente pra refetch automático.
  // Não invalidamos outros meses porque o range não toca neles.

  const createMutation = useMutation<Job, Error, JobInput>({
    mutationFn: (input: JobInput) => createJob(user!.id, input),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['agenda', user?.id, year, month] });
      // Bonus UX: se o job criado for em outro mês, navega pra lá; e seleciona
      // o dia. Evita o usuário criar pra 15/06 e continuar olhando Maio.
      if (job.scheduled_date) {
        const k = String(job.scheduled_date).slice(0, 10);
        const [yy, mm] = k.split('-').map((s) => parseInt(s, 10));
        if (yy && mm && (yy !== year || mm !== month)) {
          setYm({ year: yy, month: mm });
        }
        setSelectedDay(k);
      }
    },
  });

  const updateStatusMutation = useMutation<
    void,
    Error,
    { jobId: string; status: JobStatus }
  >({
    mutationFn: ({ jobId, status }) =>
      updateJobStatus(jobId, user!.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agenda', user?.id, year, month] });
    },
  });

  // optimize: roda contra os jobs do dia selecionado. Não invalida nada — só
  // mostra a sugestão de ordem. O hook expõe o `result` da última otimização
  // pra UI renderizar a lista numerada sem state separado.
  const optimizeMutation = useMutation<OptimizeDayResult, Error, void>({
    mutationFn: () => optimizeDayOrder(selectedDay, jobsForDay),
  });

  return {
    jobs,
    jobsForDay,
    countsByDay,

    loading: query.isLoading,
    error: query.error ?? null,

    year,
    month,
    goToMonth,

    selectedDay,
    setSelectedDay,

    create: createMutation.mutate,
    isCreating: createMutation.isPending,
    createError: createMutation.error ?? null,

    updateStatus: updateStatusMutation.mutate,
    isUpdatingStatus: updateStatusMutation.isPending,
    updateStatusError: updateStatusMutation.error ?? null,

    optimize: optimizeMutation.mutate,
    isOptimizing: optimizeMutation.isPending,
    optimizeError: optimizeMutation.error ?? null,
    optimizeResult: optimizeMutation.data ?? null,
    resetOptimize: () => optimizeMutation.reset(),
  };
}
