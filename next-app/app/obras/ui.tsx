// Peças visuais da Gestão de Obras (mesmos tokens do app — invertem no
// modo escuro sozinhos).
'use client';

import type { ReactNode } from 'react';
import { ObrasSqlPendenteError } from '@/lib/services/obras';

export const cls = {
  card: 'bg-white rounded-2xl border border-[color:var(--color-border)] p-4',
  input:
    'w-full px-3 py-2.5 border border-[color:var(--color-border)] rounded-xl text-sm bg-white text-[color:var(--color-ink)]',
  label: 'block text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-1',
  sec: 'text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-2',
  btn: 'inline-flex items-center justify-center gap-1 rounded-xl font-bold text-sm px-4 disabled:opacity-60',
  primario: 'bg-[color:var(--color-p1-button)] text-white',
  secundario: 'bg-white border border-[color:var(--color-border)] text-[color:var(--color-ink)]',
};

export function Campo({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cls.label}>{label}</label>
      {children}
    </div>
  );
}

export function Botao({
  children, onClick, primario, disabled, type = 'button', full, ariaLabel,
}: {
  children: ReactNode; onClick?: () => void; primario?: boolean; disabled?: boolean;
  type?: 'button' | 'submit'; full?: boolean; ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`${cls.btn} ${primario ? cls.primario : cls.secundario} ${full ? 'w-full' : ''}`}
      style={{ minHeight: 44 }}
    >
      {children}
    </button>
  );
}

const CHIP: Record<string, string> = {
  ativo: 'bg-[color:var(--color-ink)] text-[color:var(--color-white)]',
  em_andamento: 'bg-[color:var(--color-ink)] text-[color:var(--color-white)]',
  confirmada: 'bg-[color:var(--color-ink)] text-[color:var(--color-white)]',
};

export function Chip({ tom, children }: { tom: string; children: ReactNode }) {
  const forte = CHIP[tom];
  return (
    <span
      className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
        forte ?? 'border border-[color:var(--color-ink)] text-[color:var(--color-ink)]'
      }`}
    >
      {children}
    </span>
  );
}

/** Erro de carga — com o caso "SQL ainda não rodou" explicado, não cru. */
export function ErroObras({ erro }: { erro: unknown }) {
  const pendente = erro instanceof ObrasSqlPendenteError;
  return (
    <div role="alert" className="rounded-xl p-3 text-sm border border-[color:var(--color-border)] bg-[color:var(--color-cream)] text-[color:var(--color-ink)]">
      {pendente ? (
        <>
          A Gestão de Obras ainda não foi ativada no banco. Rode no Supabase os arquivos
          <b> 2026-09-24-b-gestao-obras-tabelas.sql</b> e <b>2026-09-24-c-gestao-obras-funcoes.sql</b>.
        </>
      ) : (
        <>{(erro as Error)?.message || 'Não foi possível carregar. Tente de novo.'}</>
      )}
    </div>
  );
}

export const brl = (n: number | null | undefined) =>
  `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
