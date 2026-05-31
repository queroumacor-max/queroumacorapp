// AgendaDay — client component, lista de jobs do dia selecionado.
// Espelha renderAgendaDay em modules/agenda.js (linha 82): label do dia,
// botão "Otimizar dia (PRO)" se 2+ jobs, card por job com status badge,
// botões "Concluir" / "Cancelar" enquanto status é "agendado".
//
// Cores do badge alinhadas com o spec:
//   - agendado    → --color-p2 (amarelo)
//   - em_andamento→ --color-p2 (amarelo) — em obra mas não fechado
//   - concluido   → --color-p3 (verde)
//   - cancelado   → --color-danger (vermelho)
//
// O modal e a otimização ficam controlados pelo pai (AgendaCalendar) via
// callbacks — esse componente é "burro" sobre data fetching: só renderiza
// o que recebe e dispara handlers.

'use client';

import type { Job, JobStatus } from '@/lib/types';
import type { OptimizeDayResult } from '@/lib/services/agenda';
import { escapeHtml } from '@/lib/utils';

// Formatador BRL ao nível de módulo (Intl.NumberFormat é caro). Mesmo padrão
// do OrderCard.
const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatBRL(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return BRL_FMT.format(0);
  return BRL_FMT.format(value);
}

// Meta visual por status. PT (vocabulário canônico do app) — quando o status
// vem como string fora do union (legacy), cai no fallback "agendado".
interface StatusMeta {
  label: string;
  bg: string; // CSS var ou hex
  fg: string;
  borderLeft: string; // cor da borda esquerda do card
}

const STATUS_MAP: Record<string, StatusMeta> = {
  agendado: {
    label: 'Agendado',
    bg: 'var(--color-p2)',
    fg: 'var(--color-ink)',
    borderLeft: 'var(--color-p2)',
  },
  em_andamento: {
    label: 'Em andamento',
    bg: 'var(--color-p2)',
    fg: 'var(--color-ink)',
    borderLeft: 'var(--color-p2)',
  },
  concluido: {
    label: 'Concluído',
    bg: 'var(--color-p3)',
    fg: '#fff',
    borderLeft: 'var(--color-p3)',
  },
  cancelado: {
    label: 'Cancelado',
    bg: 'var(--color-danger)',
    fg: '#fff',
    borderLeft: 'var(--color-danger)',
  },
};

function statusMetaFor(status: JobStatus | string): StatusMeta {
  return STATUS_MAP[status] ?? STATUS_MAP.agendado;
}

/**
 * Formata "yyyy-mm-dd" → "dd/mm/yyyy" pra label do dia. Sem Date pra evitar
 * shift de fuso — o split direto resolve.
 */
function formatDayLabel(ymd: string): string {
  const [yy, mm, dd] = ymd.split('-');
  if (!yy || !mm || !dd) return ymd;
  return `${dd}/${mm}/${yy}`;
}

export interface AgendaDayProps {
  selectedDay: string;
  jobs: Job[];
  onUpdateStatus: (jobId: string, status: JobStatus) => void;
  isUpdatingStatus: boolean;
  onOptimize: () => void;
  isOptimizing: boolean;
  optimizeError: Error | null;
  optimizeResult: OptimizeDayResult | null;
  onClearOptimize: () => void;
}

export function AgendaDay({
  selectedDay,
  jobs,
  onUpdateStatus,
  isUpdatingStatus,
  onOptimize,
  isOptimizing,
  optimizeError,
  optimizeResult,
  onClearOptimize,
}: AgendaDayProps) {
  const label = formatDayLabel(selectedDay);

  if (jobs.length === 0) {
    return (
      <div>
        <div className="text-xs font-bold text-[color:var(--color-muted)] my-2">
          {label}
        </div>
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-4xl mb-3" aria-hidden="true">
            📅
          </div>
          <h3 className="font-semibold mb-2">Sem projetos agendados</h3>
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhum projeto neste dia. Crie um pelo botão acima.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-bold text-[color:var(--color-muted)] my-2">
        {label} · {jobs.length} projeto{jobs.length > 1 ? 's' : ''}
      </div>

      {/* Botão "Otimizar dia (PRO)" — só aparece com 2+ jobs.
          Gating PRO definitivo é server-side (gateProAI em /api/agenda-order).
          Aqui mostramos pra todo logado e deixamos a resposta da API surfar
          erro de "PRO necessário" se for o caso. */}
      {jobs.length >= 2 ? (
        <>
          <button
            type="button"
            onClick={onOptimize}
            disabled={isOptimizing}
            className="w-full px-3 py-2.5 mb-2.5 text-white rounded-xl text-xs font-extrabold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #8338ec, var(--color-p1))',
              fontFamily: 'var(--font-display, "DM Sans")',
            }}
          >
            {isOptimizing
              ? '🤖 Otimizando rota com Seu Zé...'
              : '🗺️ Otimizar dia (PRO)'}
          </button>

          {optimizeError ? (
            <div
              role="alert"
              className="mb-2.5 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {optimizeError.message || 'Erro ao otimizar'}
            </div>
          ) : null}

          {optimizeResult ? (
            <OptimizeSuggestion
              result={optimizeResult}
              jobs={jobs}
              onClear={onClearOptimize}
            />
          ) : null}
        </>
      ) : null}

      <ul className="space-y-2">
        {jobs.map((j) => (
          <li key={j.id}>
            <JobCard
              job={j}
              onUpdateStatus={onUpdateStatus}
              isUpdatingStatus={isUpdatingStatus}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── JobCard ───────────────────────────────────────────────────────────────

function JobCard({
  job,
  onUpdateStatus,
  isUpdatingStatus,
}: {
  job: Job;
  onUpdateStatus: (jobId: string, status: JobStatus) => void;
  isUpdatingStatus: boolean;
}) {
  const meta = statusMetaFor(job.status);
  const canAct = job.status === 'agendado';

  return (
    <article
      className="bg-white rounded-xl p-3.5"
      style={{
        boxShadow: '0 2px 6px rgba(0,0,0,.04)',
        borderLeft: `4px solid ${meta.borderLeft}`,
      }}
    >
      <header className="flex justify-between items-start gap-2">
        <b className="text-sm truncate">{job.client_name || ''}</b>
        <span className="text-[11px] text-[color:var(--color-muted)] whitespace-nowrap">
          {job.scheduled_time || ''}
        </span>
      </header>

      <div className="text-xs text-[color:var(--color-muted)] mt-1 break-words">
        {[job.service_type, job.address].filter(Boolean).join(' · ')}
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-[11px] text-[color:var(--color-ink)] font-semibold">
          {formatBRL(job.revenue)}
        </span>
        <span className="text-[11px] text-[color:var(--color-muted)]">
          custo: {formatBRL(job.material_cost)}
        </span>
        <span
          className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
          style={{ background: meta.bg, color: meta.fg }}
        >
          {meta.label}
        </span>
      </div>

      {canAct ? (
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => onUpdateStatus(job.id, 'concluido')}
            disabled={isUpdatingStatus}
            className="flex-1 py-1.5 text-white rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'var(--color-p3)' }}
          >
            ✓ Concluir
          </button>
          <button
            type="button"
            onClick={() => onUpdateStatus(job.id, 'cancelado')}
            disabled={isUpdatingStatus}
            className="flex-1 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-muted)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
        </div>
      ) : null}
    </article>
  );
}

// ─── OptimizeSuggestion ────────────────────────────────────────────────────
// Render do resultado da IA: lista numerada (1, 2, 3…) com cliente + endereço
// na ordem sugerida. Espelha o markup do `agenda-day-suggest` no vanilla.

function OptimizeSuggestion({
  result,
  jobs,
  onClear,
}: {
  result: OptimizeDayResult;
  jobs: Job[];
  onClear: () => void;
}) {
  // Map id→job pra reconstruir os cards na ordem sugerida.
  const byId: Record<string, Job> = {};
  for (const j of jobs) byId[String(j.id)] = j;

  return (
    <div
      className="bg-white border-[1.5px] rounded-xl p-3 mb-2.5"
      style={{
        borderColor: '#8338ec',
        boxShadow: '0 2px 8px rgba(131,56,236,.12)',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div
          className="text-xs font-extrabold"
          style={{ color: '#8338ec' }}
        >
          🗺️ Ordem sugerida pelo Seu Zé
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Fechar sugestão"
          className="text-[color:var(--color-muted)] text-base leading-none px-1 cursor-pointer"
        >
          ×
        </button>
      </div>
      {result.ordered_ids.map((id, i) => {
        const j = byId[String(id)];
        if (!j) return null;
        return (
          <div
            key={id}
            className="flex items-start gap-2 py-1.5"
            style={{ borderBottom: '1px solid rgba(0,0,0,.05)' }}
          >
            <div
              className="w-5.5 h-5.5 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0"
              style={{
                width: 22,
                height: 22,
                background: 'linear-gradient(135deg, #8338ec, var(--color-p1))',
              }}
            >
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[color:var(--color-ink)]">
                {/* escapeHtml não é necessário aqui — React já escapa. Mantemos
                    a chamada só por paridade com o vanilla; em prática vira
                    string idêntica salvo entidades HTML. */}
                {j.client_name || ''}
                {j.scheduled_time ? (
                  <span className="font-normal text-[color:var(--color-muted)]">
                    {' · '}
                    {escapeHtml(j.scheduled_time)}
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-[color:var(--color-muted)] mt-0.5">
                {j.address || '(sem endereço)'}
              </div>
            </div>
          </div>
        );
      })}
      {result.notes ? (
        <div className="text-[11px] text-[color:var(--color-muted)] mt-2 italic">
          {result.notes}
        </div>
      ) : null}
      <div
        className="text-[10px] text-[color:var(--color-muted)] mt-2 rounded-lg p-1.5 px-2"
        style={{ background: 'var(--color-bg)' }}
      >
        ⚠️ Sugestão baseada só no texto do endereço (não usa GPS). Confirme a rota
        no seu app de mapas.
      </div>
    </div>
  );
}
