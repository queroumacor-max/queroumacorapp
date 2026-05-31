// AgendaCalendar — client component, grid mensal do calendário do pintor.
// Espelha o markup de renderAgendaCal em modules/agenda.js (linha 51), mas
// como JSX declarativo: dots em dias com jobs, célula selecionada, célula de
// hoje destacada, navegação ‹ Mês › nas setas.
//
// Decisão custom grid vs <input type="month">: o spec sugeriu custom pra
// controlar visual — e o vanilla já fazia grid 7-col com dots. Mantemos o
// padrão pra usuário não estranhar a tela ao alternar entre vanilla e Next.
//
// Estados:
//   - authLoading → skeleton (sessão restaurando)
//   - !user → CTA de login
//   - loading → skeleton do calendário + lista
//   - error → mensagem inline
//   - default → calendar + AgendaDay
//
// O modal de criar projeto é state local (não Context) — o spec pediu
// explícito. AgendaCalendar gerencia o `modalOpen` e passa pra JobFormModal.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useAgenda } from '@/lib/hooks/useAgenda';
import { AgendaDay } from './AgendaDay';
import { JobFormModal } from './JobFormModal';

// Labels PT-BR via Intl pra alinhar com o resto do app (em vez de array
// hard-coded como no vanilla). `month: 'long'` dá "Maio", "Junho", etc.
const MONTH_FMT = new Intl.DateTimeFormat('pt-BR', { month: 'long' });

// Cabeçalho dos dias da semana (D S T Q Q S S) — começa domingo pra bater
// com `Date.getDay()` que retorna 0=Dom.
const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/**
 * Helper: formata "yyyy-mm-dd" no fuso local (sem shift UTC). Usado pra
 * comparar células do grid com `selectedDay` / `todayKey`. Inline aqui em
 * vez de importar agYmd pra não acoplar — só usamos pra hoje.
 */
function localYmd(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function MonthHeader({
  year,
  month,
  onPrev,
  onNext,
}: {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Cria Date(year, month-1, 1) só pra formatar o nome do mês.
  const label = MONTH_FMT.format(new Date(year, month - 1, 1));
  // Primeira letra maiúscula (Intl devolve minúsculo em pt-BR: "maio").
  const monthLabel = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <div className="flex items-center justify-between mb-3">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Mês anterior"
        className="w-8 h-8 rounded-lg bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-base font-semibold cursor-pointer hover:bg-[color:var(--color-border)] transition-colors"
      >
        ‹
      </button>
      <div
        className="font-extrabold text-base"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {monthLabel} {year}
      </div>
      <button
        type="button"
        onClick={onNext}
        aria-label="Próximo mês"
        className="w-8 h-8 rounded-lg bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-base font-semibold cursor-pointer hover:bg-[color:var(--color-border)] transition-colors"
      >
        ›
      </button>
    </div>
  );
}

interface GridProps {
  year: number;
  month: number; // 1-12
  countsByDay: Record<string, number>;
  selectedDay: string;
  onSelectDay: (d: string) => void;
}

function CalendarGrid({
  year,
  month,
  countsByDay,
  selectedDay,
  onSelectDay,
}: GridProps) {
  // Date(year, month-1, 1).getDay() = índice do dia da semana do dia 1 (0=Dom).
  // Date(year, month, 0).getDate() = último dia do mês corrente (pra Maio → 31).
  const startDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = localYmd(new Date());

  // 7 cells de cabeçalho + N preenchimento + N dias do mês.
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < startDow; i++) {
    cells.push(<div key={`pad-${i}`} aria-hidden="true" />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const has = countsByDay[key] || 0;
    const isSelected = key === selectedDay;
    const isToday = key === todayKey;

    // Hierarquia visual: selecionado vence today, today vence default.
    let cellClass =
      'aspect-square flex flex-col items-center justify-center rounded-xl cursor-pointer text-sm font-semibold transition-colors';
    let cellStyle: React.CSSProperties = {};
    if (isSelected) {
      cellStyle = {
        background: 'var(--color-p1)',
        color: '#fff',
      };
    } else if (isToday) {
      cellStyle = {
        background: 'var(--color-bg)',
        color: 'var(--color-ink)',
        border: '1.5px solid var(--color-p1)',
      };
    } else {
      cellStyle = { color: 'var(--color-ink)' };
      cellClass += ' hover:bg-[color:var(--color-bg)]';
    }

    cells.push(
      <button
        key={key}
        type="button"
        onClick={() => onSelectDay(key)}
        aria-label={`Dia ${d}${has ? `, ${has} projeto${has > 1 ? 's' : ''}` : ''}`}
        aria-pressed={isSelected}
        className={cellClass}
        style={cellStyle}
      >
        {d}
        {has ? (
          <span
            aria-hidden="true"
            className="block w-1.5 h-1.5 rounded-full mt-0.5"
            style={{ background: isSelected ? '#fff' : 'var(--color-p1)' }}
          />
        ) : null}
      </button>
    );
  }

  return (
    <div className="grid grid-cols-7 gap-1">
      {DOW.map((d, i) => (
        <div
          key={`dow-${i}`}
          className="text-center text-[10px] font-bold text-[color:var(--color-muted)] py-1"
        >
          {d}
        </div>
      ))}
      {cells}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div
      className="bg-white rounded-2xl border border-[color:var(--color-border)] p-4 animate-pulse"
      aria-label="Carregando calendário"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-8 h-8 rounded-lg bg-[color:var(--color-border)]" />
        <div className="h-4 w-32 bg-[color:var(--color-border)] rounded" />
        <div className="w-8 h-8 rounded-lg bg-[color:var(--color-border)]" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 42 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-xl bg-[color:var(--color-border)]"
          />
        ))}
      </div>
    </div>
  );
}

export function AgendaCalendar() {
  const { user, loading: authLoading } = useAuth();
  const {
    jobsForDay,
    countsByDay,
    loading,
    error,
    year,
    month,
    goToMonth,
    selectedDay,
    setSelectedDay,
    create,
    isCreating,
    createError,
    updateStatus,
    isUpdatingStatus,
    optimize,
    isOptimizing,
    optimizeError,
    optimizeResult,
    resetOptimize,
  } = useAgenda();

  // Modal local (não Context) — state controlado aqui, JobFormModal recebe
  // open/onClose como props. Mesmo padrão de Dialog em React.
  const [modalOpen, setModalOpen] = useState(false);

  if (authLoading) {
    return <CalendarSkeleton />;
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📅
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver sua agenda</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Calendário de projetos aparece aqui depois que você faz login.
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
    return (
      <>
        <CalendarSkeleton />
        <div className="mt-4 space-y-2" aria-label="Carregando projetos">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-white border border-[color:var(--color-border)] animate-pulse"
            />
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar a agenda. Tente de novo em instantes.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Botão "Novo projeto" abre o modal. PRO gating não acontece aqui (é
          checagem do otimizador IA, não da criação de jobs). */}
      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          + Novo projeto
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-[color:var(--color-border)] p-4 mb-4">
        <MonthHeader
          year={year}
          month={month}
          onPrev={() => goToMonth(-1)}
          onNext={() => goToMonth(1)}
        />
        <CalendarGrid
          year={year}
          month={month}
          countsByDay={countsByDay}
          selectedDay={selectedDay}
          onSelectDay={(d) => {
            setSelectedDay(d);
            // Limpa sugestão de otimização ao trocar de dia — ordem antiga
            // não faz sentido pro novo conjunto.
            resetOptimize();
          }}
        />
      </div>

      <AgendaDay
        selectedDay={selectedDay}
        jobs={jobsForDay}
        onUpdateStatus={(jobId, status) => updateStatus({ jobId, status })}
        isUpdatingStatus={isUpdatingStatus}
        onOptimize={() => optimize()}
        isOptimizing={isOptimizing}
        optimizeError={optimizeError}
        optimizeResult={optimizeResult}
        onClearOptimize={resetOptimize}
      />

      <JobFormModal
        open={modalOpen}
        defaultDate={selectedDay}
        onClose={() => setModalOpen(false)}
        onSubmit={(input) => {
          create(input);
        }}
        isSubmitting={isCreating}
        submitError={createError}
        // Fecha quando criação dá certo (createError null + estava criando antes).
        // Detectar isso aqui exige um useEffect — feito dentro do modal pra
        // manter AgendaCalendar enxuto.
      />
    </>
  );
}
