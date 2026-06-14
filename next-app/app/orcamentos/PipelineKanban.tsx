// PipelineKanban — client component que renderiza o kanban de orçamentos
// do pintor. Equivale à `renderPipeline` do vanilla (modules/pipeline.js
// linha 113), mas com lanes lado-a-lado em vez de seções verticais
// empilhadas — espaço de tela do desktop justifica essa mudança visual.
//
// Estados (alinhados com PedidosList / LeadsList):
//   - authLoading → skeleton de 4 cards
//   - !user → CTA pra login
//   - loading → skeleton de 4 cards
//   - error → mensagem inline (sem throw)
//   - quotes.length === 0 → empty state
//   - default → grid horizontal de lanes
//
// Cada ação dispara o método correspondente do usePipeline; mutationErrors
// surgem como banner vermelho no topo. Confirmações UX usam useDialog()
// in-app (sem prompt/confirm/alert nativos do browser).

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { PIPELINE_LANES, type PipelineStatus } from '@/lib/services/pipeline';
import type { Quote } from '@/lib/types';
import { QuoteCard } from './QuoteCard';

// Formatter BRL pra exibir sugestão de preço no input — mesma instância em
// todos os calls.
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function SkeletonCard() {
  return (
    <div
      className="bg-white rounded-2xl border border-[color:var(--color-border)] p-3 animate-pulse"
      aria-hidden="true"
    >
      <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded mb-2" />
      <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded mb-3" />
      <div className="h-3 w-1/3 bg-[color:var(--color-border)] rounded mb-3" />
      <div className="h-8 w-full bg-[color:var(--color-border)] rounded" />
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-3" aria-label="Carregando orçamentos">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

function resolveStatus(raw: string | null | undefined): PipelineStatus {
  if (!raw) return 'rascunho';
  // Rótulos legados que ainda podem aparecer em rows antigas: 'aceito' →
  // aprovado; 'pending' → enviado (mesmo destino da migração do banco).
  if (raw === 'aceito') return 'aprovado';
  if (raw === 'pending') return 'enviado';
  const valid: PipelineStatus[] = [
    'rascunho',
    'enviado',
    'aprovado',
    'em_execucao',
    'concluido',
    'recusado',
  ];
  return (valid as string[]).includes(raw)
    ? (raw as PipelineStatus)
    : 'rascunho';
}

export function PipelineKanban() {
  const { user, loading: authLoading } = useAuth();
  const dialog = useDialog();
  const {
    quotes,
    loading,
    error,
    send,
    isSending,
    sendError,
    approve,
    isApproving,
    approveError,
    reject,
    isRejecting,
    rejectError,
    advance,
    isAdvancing,
    advanceError,
    suggest,
    isSuggesting,
    suggestError,
  } = usePipeline();

  // Mensagem agregada da última mutation que falhou — UI mostra banner único
  // em vez de 5 banners por mutation. `||` cascateia o primeiro não-nulo.
  const mutationError =
    sendError || approveError || rejectError || advanceError || suggestError;

  // Banner informativo quando o suggest retornar — pré-preenche o input de
  // envio com o valor sugerido + mostra justificativa do Seu Zé.
  const [suggestion, setSuggestion] = useState<{
    id: string;
    price: number;
    justification: string;
  } | null>(null);

  // Agrupa quotes por lane usando PIPELINE_LANES como fonte da verdade da
  // ordem visual. useMemo evita refazer a partição a cada render.
  const groups = useMemo(() => {
    return PIPELINE_LANES.map((lane) => {
      const inLane = quotes.filter((q) =>
        lane.statuses.includes(resolveStatus(q.status))
      );
      return { ...lane, quotes: inLane };
    });
  }, [quotes]);

  // Ações usam dialog in-app (substitui window.prompt/confirm nativos).
  const handleSend = async (id: string, presetPrice?: number) => {
    const current = quotes.find((q) => q.id === id);
    const defaultStr =
      presetPrice && presetPrice > 0
        ? String(presetPrice)
        : current && Number(current.price) > 0
          ? String(current.price)
          : '';
    const raw = await dialog.prompt('Valor do orçamento (R$):', defaultStr, {
      title: 'Enviar orçamento',
      okLabel: 'Próximo',
    });
    if (raw == null) return;
    const price = Number(String(raw).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0) {
      await dialog.alert('Informe um valor válido.');
      return;
    }
    const proposedDate = await dialog.prompt(
      'Prazo de conclusão (AAAA-MM-DD) — deixe em branco se a combinar:',
      current?.proposed_date || '',
      { title: 'Prazo', okLabel: 'Próximo' },
    );
    if (proposedDate == null) return;
    const warrantyDefault =
      ((current?.quote_data as { warranty?: string } | null)?.warranty) ||
      '90 dias para retoques';
    const warranty = await dialog.prompt('Garantia oferecida:', warrantyDefault, {
      title: 'Garantia',
      okLabel: 'Enviar',
    });
    if (warranty == null) return;
    send({
      id,
      price,
      proposedDate: proposedDate.trim() || null,
      warranty: warranty.trim() || null,
    });
    setSuggestion(null);
  };

  const handleSuggest = async (id: string) => {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    try {
      const out = await suggest({
        service_type: q.service_type || q.title || '',
        description: q.description || '',
        area_m2: q.area_m2 ?? null,
      });
      setSuggestion({ id, price: out.price, justification: out.justification });
    } catch {
      // Erro propaga via suggestError — banner mostra a mensagem.
    }
  };

  const handleApprove = async (id: string) => {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    const ok = await dialog.confirm(
      'Marcar este orçamento como aceito pelo cliente?\n\nO escopo e o valor ficam congelados como referência acordada.',
      { title: 'Aprovar orçamento', okLabel: 'Aprovar' },
    );
    if (!ok) return;
    const note = await dialog.prompt('Observação da aprovação (opcional):', '', {
      title: 'Observação',
      okLabel: 'Confirmar',
    });
    if (note === null) return;
    approve({ id, quote: q, note });
  };

  const handleReject = async (id: string) => {
    const ok = await dialog.confirm('Marcar este orçamento como recusado?', {
      title: 'Recusar',
      okLabel: 'Recusar',
      danger: true,
    });
    if (!ok) return;
    reject(id);
  };

  const handleAdvance = (
    id: string,
    status: 'em_execucao' | 'concluido'
  ) => {
    advance({ id, status });
  };

  const isBusy = isSending || isApproving || isRejecting || isAdvancing;

  // ─── render states ────────────────────────────────────────────────

  if (authLoading) return <SkeletonGrid />;

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📋
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver seus orçamentos</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Faça login pra acessar o pipeline de orçamentos.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  if (loading) return <SkeletonGrid />;

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar o pipeline. Tente de novo em instantes.
        </p>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📋
        </div>
        <h2 className="font-semibold mb-2">Nenhum orçamento ainda</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          Quando um cliente pedir orçamento, ele aparece aqui. Você também pode
          salvar orçamentos da Calculadora no Pipeline.
        </p>
      </div>
    );
  }

  return (
    <div>
      {mutationError ? (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {mutationError.message ||
            'Não foi possível concluir a ação. Tente de novo.'}
        </div>
      ) : null}

      {suggestion ? (
        <div
          role="status"
          className="mb-4 p-3 rounded-xl bg-[#f5f3ff] border border-[#ddd6fe] text-sm"
        >
          <div className="font-bold text-[#5b21b6] mb-1">
            💡 Seu Zé sugere {BRL.format(suggestion.price)}
          </div>
          {suggestion.justification ? (
            <div className="text-[#6b21a8] mb-2">{suggestion.justification}</div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleSend(suggestion.id, suggestion.price)}
              className="px-3 py-1.5 bg-[color:var(--color-p1)] text-white rounded-lg text-xs font-bold"
            >
              Usar e enviar
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="px-3 py-1.5 bg-white border border-[color:var(--color-border)] rounded-lg text-xs font-bold"
            >
              Descartar
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {groups.map((lane) => (
          <section
            key={lane.title}
            aria-label={`Lane ${lane.title}`}
            className="bg-[color:var(--color-bg)] rounded-2xl p-3 min-h-[160px]"
          >
            <header className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-[color:var(--color-muted)]">
                {lane.title}
              </h2>
              <span className="text-xs font-bold text-[color:var(--color-muted)] bg-white rounded-full px-2 py-0.5">
                {lane.quotes.length}
              </span>
            </header>
            {lane.quotes.length === 0 ? (
              <div className="text-xs text-[color:var(--color-muted)] text-center py-6">
                Sem orçamentos
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {lane.quotes.map((q: Quote) => (
                  <QuoteCard
                    key={q.id}
                    quote={q}
                    onSend={(id) => handleSend(id)}
                    onSuggestPrice={handleSuggest}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onAdvance={handleAdvance}
                    isSuggesting={isSuggesting}
                    isBusy={isBusy}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
