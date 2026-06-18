// Dashboard — client component que orquestra a tela /financeiro. Espelha o
// output de loadFinanceiro() do vanilla (modules/financeiro.js):
//   - 3 cards KPI (Receita / Custos / Lucro) com R$ formatado pt-BR;
//   - gráfico simples em CSS (divs com width:%) — sem chart.js, overkill
//     pra 3 barras estáticas;
//   - lista de lançamentos com botão de apagar;
//   - botão "Adicionar lançamento" abre o modal EntryForm;
//   - AnalysisCard com botão de análise IA (gated por canSeeProFeature).
//
// Pattern de estados idêntico ao PedidosList/LeadsList:
//   - authLoading → skeleton
//   - !user → CTA de login
//   - loading → skeleton de cards + lista
//   - error → mensagem inline
//   - entries.length===0 → empty state com dica
//   - default → KPIs + chart + lista + AnalysisCard
//
// Sobre "não vira R$ —" durante refetch: o hook usa `keepPreviousData` que
// preserva `entries` durante refetch. UI lê `loading` (só primeira vez) vs
// `isFetching` (qualquer refetch) — só mostra skeleton no loading inicial.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { useFinanceiro } from '@/lib/hooks/useFinanceiro';
import { fmtBRL, escapeHtml } from '@/lib/utils';
import { EntryForm } from './EntryForm';
import { LaunchCostSheet } from './LaunchCostSheet';
import { AnalysisCard } from './AnalysisCard';
import type { Job } from '@/lib/types';

// Formata "R$ 1.234,56" — espelha o output do vanilla
// (`'R$ '+n.toLocaleString('pt-BR')`). fmtBRL já devolve "1.234,56".
// fmtBRL retorna '' pra n<0 (é formatador de não-negativo), então tratamos
// o sinal aqui: negativo vira "−R$ 150,00" (antes saía "R$ " sem número — BUG28).
function brl(n: number): string {
  if (Number.isFinite(n) && n < 0) return '−R$ ' + fmtBRL(Math.abs(n));
  return 'R$ ' + fmtBRL(n);
}

// "dd/mm/yyyy" no fuso local — Intl.DateTimeFormat respeita o timezone do
// browser, então um lançamento de hoje aparece como "hoje" pro usuário.
const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return DATE_FMT.format(d);
}

// Card KPI individual — cor configurável pra Receita (verde), Custos
// (vermelho), Lucro (primary). Tag aria-label inclui o número falado pra
// screen readers (R$ formatado às vezes é lido estranho como "rs").
function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'success' | 'danger' | 'primary';
}) {
  const valueColor =
    accent === 'success'
      ? 'text-[#2ec4b6]'
      : accent === 'danger'
        ? 'text-[#e63946]'
        : 'text-[color:var(--color-p1)]';
  return (
    <div
      className="bg-white rounded-xl border border-[color:var(--color-border)] p-4"
      aria-label={`${label}: ${value.toLocaleString('pt-BR')} reais`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-muted)] mb-1">
        {label}
      </div>
      <div className={`text-xl font-bold ${valueColor}`}>{brl(value)}</div>
    </div>
  );
}

// Gráfico de barras horizontais — divs com width:% relativo ao maior
// absoluto. Mesma lógica do vanilla (modules/financeiro.js linha 38-50).
// Mantém min width 2% pra que valores zero ainda apareçam visualmente.
function MiniBarChart({
  receita,
  custos,
  lucro,
  count,
}: {
  receita: number;
  custos: number;
  lucro: number;
  count: number;
}) {
  const max = Math.max(receita, custos, Math.abs(lucro), 1);
  const bars: Array<{ label: string; value: number; color: string }> = [
    { label: 'Receita', value: receita, color: '#2ec4b6' },
    { label: 'Gasto', value: custos, color: '#e63946' },
    { label: 'Lucro', value: lucro, color: 'var(--color-p1)' },
  ];
  return (
    <div className="bg-white rounded-xl border border-[color:var(--color-border)] p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
        Resumo
      </div>
      {bars.map((b) => {
        const pct = Math.max(2, Math.round((Math.abs(b.value) / max) * 100));
        return (
          <div key={b.label} className="mb-2">
            <div className="flex justify-between text-[11px] text-[color:var(--color-muted)] mb-1">
              <span>{b.label}</span>
              <span className="font-bold text-[color:var(--color-ink)]">
                {brl(b.value)}
              </span>
            </div>
            <div className="bg-[color:var(--color-border)] rounded-md h-2.5 overflow-hidden">
              <div
                className="h-full rounded-md"
                style={{ width: `${pct}%`, background: b.color }}
              />
            </div>
          </div>
        );
      })}
      <div className="text-[11px] text-[color:var(--color-muted)] mt-2">
        {count} lançamento{count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

// Linha individual da lista de lançamentos. Mostra título + cliente +
// receb./gasto em texto auxiliar, e o lucro líquido grande à direita
// (verde se positivo, vermelho se negativo). Botão × apaga.
function EntryRow({
  entry,
  onDelete,
  isRemoving,
  onLaunchCost,
}: {
  entry: Job;
  onDelete: (id: string) => void;
  isRemoving: boolean;
  onLaunchCost: () => void;
}) {
  const receita = Number(entry.revenue) || 0;
  const custo = Number(entry.material_cost) || 0;
  const lc = receita - custo;
  const lcColor = lc >= 0 ? 'text-[#2ec4b6]' : 'text-[#e63946]';
  return (
    <li className="flex items-center gap-2 py-3 border-b border-[color:var(--color-border)]">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-[color:var(--color-ink)] truncate">
          {escapeHtml(entry.service_type || 'Projeto')}
        </div>
        <div className="text-[11px] text-[color:var(--color-muted)] truncate">
          {escapeHtml(entry.client_name || '-')}
          {' · '}
          Receb. {brl(receita)}
          {' · '}
          Gasto {brl(custo)}
          {entry.created_at ? ` · ${fmtDate(entry.created_at)}` : ''}
        </div>
      </div>
      <div className={`font-extrabold text-sm whitespace-nowrap ${lcColor}`}>
        {brl(lc)}
      </div>
      <button
        type="button"
        onClick={onLaunchCost}
        aria-label="Lançar custo neste projeto"
        title="Lançar custo"
        className="text-[color:var(--color-p1)] hover:opacity-80 text-base px-2 py-1 font-bold"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        disabled={isRemoving}
        aria-label="Apagar lançamento"
        className="text-[color:var(--color-muted)] hover:text-[#e63946] text-lg px-2 py-1 disabled:opacity-50"
      >
        ×
      </button>
    </li>
  );
}

// Skeleton dos KPIs + chart + lista. Mantém o footprint pra evitar CLS
// quando os dados chegam.
function Skeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando financeiro">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 animate-pulse"
          >
            <div className="h-2 w-16 bg-[color:var(--color-border)] rounded mb-2" />
            <div className="h-5 w-24 bg-[color:var(--color-border)] rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 animate-pulse">
        <div className="h-3 w-20 bg-[color:var(--color-border)] rounded mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-2 bg-[color:var(--color-border)] rounded mb-2" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 bg-white rounded-xl border border-[color:var(--color-border)] animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const {
    entries,
    summary,
    loading,
    error,
    create,
    isCreating,
    createError,
    remove,
    isRemoving,
    removeError,
    addCost,
    isAddingCost,
    analyze,
    isAnalyzing,
    analysis,
    analyzeError,
    resetAnalysis,
  } = useFinanceiro();
  const dialog = useDialog();
  const [formOpen, setFormOpen] = useState(false);
  const [costEntryId, setCostEntryId] = useState<string | null>(null);
  const costEntry = costEntryId
    ? entries.find((e) => e.id === costEntryId)
    : null;

  // Apagar com confirmação (BUG29 — antes o × deletava na hora, risco de
  // deleção acidental).
  async function handleDelete(id: string) {
    const ok = await dialog.confirm(
      'Apagar este lançamento? Essa ação não pode ser desfeita.',
      { title: 'Apagar lançamento', okLabel: 'Apagar', danger: true },
    );
    if (ok) remove(id);
  }

  if (authLoading) {
    return <Skeleton />;
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          💰
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver seu financeiro</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Seu controle de lucro aparece aqui depois que você faz login.
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

  if (loading) {
    return <Skeleton />;
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar o financeiro. Tente de novo em instantes.
        </p>
      </div>
    );
  }

  const isEmpty = entries.length === 0;

  return (
    <div className="space-y-4">
      {/* KPIs sempre visíveis — durante refetch (keepPreviousData) os valores
          ficam do snapshot anterior em vez de virar "R$ —", pattern do vanilla. */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Receita" value={summary.receita} accent="success" />
        <KpiCard label="Custos" value={summary.custos} accent="danger" />
        <KpiCard label="Lucro" value={summary.lucro} accent="primary" />
      </div>

      <MiniBarChart
        receita={summary.receita}
        custos={summary.custos}
        lucro={summary.lucro}
        count={summary.count}
      />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[color:var(--color-muted)]">
          Lançamentos
        </h2>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold"
        >
          + Adicionar
        </button>
      </div>

      {removeError ? (
        <div
          role="alert"
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {removeError.message || 'Não foi possível apagar o lançamento.'}
        </div>
      ) : null}

      {isEmpty ? (
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-4xl mb-3" aria-hidden="true">
            💰
          </div>
          <h3 className="font-semibold mb-2">Sem lançamentos ainda</h3>
          <p className="text-sm text-[color:var(--color-muted)]">
            Registre receitas e despesas pra acompanhar seu lucro. Projetos
            concluídos no Pipeline também entram aqui automaticamente.
          </p>
        </div>
      ) : (
        <ul className="bg-white rounded-xl border border-[color:var(--color-border)] px-4">
          {entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              onDelete={handleDelete}
              isRemoving={isRemoving}
              onLaunchCost={() => setCostEntryId(e.id)}
            />
          ))}
        </ul>
      )}

      <AnalysisCard
        onAnalyze={analyze}
        isAnalyzing={isAnalyzing}
        analysis={analysis}
        error={analyzeError}
        onReset={resetAnalysis}
        hasEntries={!isEmpty}
      />

      {formOpen ? (
        <EntryForm
          onClose={() => setFormOpen(false)}
          onSubmit={(input) => {
            create(input);
          }}
          isSubmitting={isCreating}
          error={createError}
        />
      ) : null}

      <LaunchCostSheet
        open={!!costEntry}
        entry={costEntry ?? null}
        onClose={() => setCostEntryId(null)}
        onConfirm={(delta) => {
          if (!costEntry) return;
          addCost({ entryId: costEntry.id, delta });
          setCostEntryId(null);
        }}
        isSubmitting={isAddingCost}
      />
    </div>
  );
}
