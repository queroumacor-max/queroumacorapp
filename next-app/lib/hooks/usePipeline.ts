// usePipeline — hook React que centraliza leitura + escrita de quotes do
// pintor via TanStack Query, com invalidação automática a partir de um
// channel Supabase Realtime filtrado por painter_id.
//
// Substitui o trio vanilla (modules/pipeline.js: loadPipeline +
// setupPipelineSubscription + chamadas imperativas das mutations) por:
//   - useQuery faz fetch + cache (staleTime 30s — quotes mudam quando o
//     cliente aprova/recusa no app, então invalidar mais agressivo evita
//     ver dado velho);
//   - useEffect monta channel Realtime e invalida queryKey em qualquer
//     INSERT/UPDATE em quotes do painter (subscrição idêntica à do vanilla,
//     filtrada por painter_id pra economizar broadcasts);
//   - useMutation cobre send/approve/reject/setStage/save com invalidação
//     automática on success.
//
// Cleanup obrigatório do channel via removeChannel — mesmo pattern do
// useNotifications. Sem isso, navegar pra /pipeline e voltar duplicaria o
// listener (vazamento + double-invalidate).

'use client';

import { useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import {
  fetchQuotes,
  saveQuote,
  sendQuote,
  approveQuote,
  rejectQuote,
  setQuoteStage,
  suggestPrice,
  type SaveQuoteInput,
  type SuggestPriceInput,
  type SuggestPriceResult,
} from '@/lib/services/pipeline';
import type { Quote } from '@/lib/types';

export interface UsePipelineResult {
  quotes: Quote[];
  loading: boolean;
  error: Error | null;
  // Mutations — retorno alinhado com useLeads/useNotifications: `mutate`
  // (fire-and-forget) + `isPending` (loading) + `error` (último erro).
  save: (input: SaveQuoteInput) => void;
  isSaving: boolean;
  saveError: Error | null;
  send: (args: { id: string; price: number; warranty?: string | null; proposedDate?: string | null }) => void;
  isSending: boolean;
  sendError: Error | null;
  approve: (args: { id: string; quote: Quote; note?: string | null }) => void;
  isApproving: boolean;
  approveError: Error | null;
  reject: (id: string) => void;
  isRejecting: boolean;
  rejectError: Error | null;
  advance: (args: { id: string; status: 'em_execucao' | 'concluido' }) => void;
  isAdvancing: boolean;
  advanceError: Error | null;
  // IA: sugerir preço. Usa mutateAsync pra UI conseguir aguardar o resultado
  // e pré-preencher o input — mutate (fire-and-forget) não devolve o valor.
  suggest: (input: SuggestPriceInput) => Promise<SuggestPriceResult>;
  isSuggesting: boolean;
  suggestError: Error | null;
}

export function usePipeline(): UsePipelineResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;

  const query = useQuery<Quote[], Error>({
    queryKey: ['pipeline', userId],
    queryFn: () => fetchQuotes(userId!),
    enabled: !!userId,
    staleTime: 30_000,
  });

  // Realtime: filter por painter_id pra cada client só receber mudanças
  // suas. Mesmo padrão do useNotifications, mas escuta `*` em vez de só
  // INSERT — quote evolui via UPDATE (cliente aprova, pintor avança status)
  // mais do que via INSERT, e queremos refletir as duas.
  useEffect(() => {
    if (!userId) return;
    const sb = getSupabase();
    const channel = sb
      .channel('pipeline:' + userId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quotes',
          filter: `painter_id=eq.${userId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['pipeline', userId] });
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, qc]);

  // Helper: factory de onSuccess que sempre invalida a queryKey do pipeline.
  // Centralizar evita esquecer em alguma mutation nova.
  const onMutationSuccess = () => {
    qc.invalidateQueries({ queryKey: ['pipeline', userId] });
  };

  const saveMutation = useMutation<{ quoteId: string }, Error, SaveQuoteInput>({
    mutationFn: (input) => saveQuote(input),
    onSuccess: onMutationSuccess,
  });

  const sendMutation = useMutation<
    void,
    Error,
    { id: string; price: number; warranty?: string | null; proposedDate?: string | null }
  >({
    mutationFn: ({ id, price, warranty, proposedDate }) =>
      sendQuote(id, price, userId!, { warranty, proposedDate }),
    onSuccess: onMutationSuccess,
  });

  const approveMutation = useMutation<
    void,
    Error,
    { id: string; quote: Quote; note?: string | null }
  >({
    mutationFn: ({ id, quote, note }) =>
      approveQuote(id, quote, userId!, note ?? null),
    onSuccess: onMutationSuccess,
  });

  const rejectMutation = useMutation<void, Error, string>({
    mutationFn: (id) => rejectQuote(id, userId!),
    onSuccess: onMutationSuccess,
  });

  const advanceMutation = useMutation<
    void,
    Error,
    { id: string; status: 'em_execucao' | 'concluido' }
  >({
    mutationFn: ({ id, status }) => setQuoteStage(id, status, userId!),
    onSuccess: onMutationSuccess,
  });

  // Suggest NÃO invalida o cache — só devolve um valor pra UI pré-preencher
  // input de preço. A mudança real só acontece em sendMutation depois.
  const suggestMutation = useMutation<
    SuggestPriceResult,
    Error,
    SuggestPriceInput
  >({
    mutationFn: (input) => suggestPrice(input),
  });

  return {
    quotes: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,

    save: saveMutation.mutate,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error ?? null,

    send: sendMutation.mutate,
    isSending: sendMutation.isPending,
    sendError: sendMutation.error ?? null,

    approve: approveMutation.mutate,
    isApproving: approveMutation.isPending,
    approveError: approveMutation.error ?? null,

    reject: rejectMutation.mutate,
    isRejecting: rejectMutation.isPending,
    rejectError: rejectMutation.error ?? null,

    advance: advanceMutation.mutate,
    isAdvancing: advanceMutation.isPending,
    advanceError: advanceMutation.error ?? null,

    suggest: suggestMutation.mutateAsync,
    isSuggesting: suggestMutation.isPending,
    suggestError: suggestMutation.error ?? null,
  };
}
