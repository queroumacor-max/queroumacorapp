// QualsSection — client component que renderiza a lista de formações +
// formulário inline pra adicionar uma nova. Espelha o output de
// `loadQualsList()` + UX de `addQualification()` em modules/quals-courses.js.
//
// Diferenças vs vanilla:
//  - sem modal: o form fica inline no topo (rota dedicada não precisa
//    sobreposição);
//  - submit usa <form onSubmit> + uncontrolled inputs com `defaultValue`
//    limpos por `e.currentTarget.reset()` (em vez do vanilla que limpa cada
//    input via getElementById);
//  - estados de loading/empty/error consistentes com NotificationsList.

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useQualifications } from '@/lib/hooks/useQualifications';
import type { Qualification } from '@/lib/services/formacao';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)] animate-pulse">
      <div className="w-10 h-10 rounded-full bg-[color:var(--color-border)]" />
      <div className="flex-1">
        <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
      </div>
    </div>
  );
}

function QualRow({
  q,
  onRemove,
  removing,
}: {
  q: Qualification;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)]">
      <span
        className="w-10 h-10 rounded-full bg-[color:var(--color-bg)] flex items-center justify-center text-lg flex-shrink-0"
        aria-hidden="true"
      >
        {q.icon || '🎓'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm truncate">
          {q.title || '(sem título)'}
        </span>
        <span className="block text-xs text-[color:var(--color-muted)] truncate">
          {q.org || ''}
          {q.year ? ` · ${q.year}` : ''}
        </span>
      </span>
      <button
        type="button"
        onClick={() => onRemove(q.id)}
        disabled={removing}
        className="text-xs font-semibold text-red-600 disabled:opacity-50 px-2 py-1"
        aria-label={`Remover ${q.title || 'formação'}`}
      >
        Remover
      </button>
    </li>
  );
}

export function QualsSection() {
  const { user, loading: authLoading } = useAuth();
  const {
    qualifications,
    loading,
    error,
    add,
    remove,
    isAdding,
    isRemoving,
    addError,
  } = useQualifications();
  // Estado local pra exibir mensagem inline pós-erro (o hook expõe addError,
  // mas queremos limpar quando o usuário começa a digitar de novo).
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    if (!title) {
      setSubmitError('Informe o título.');
      return;
    }
    const institution = String(fd.get('institution') || '').trim();
    const year = String(fd.get('year') || '').trim();
    add(
      {
        title,
        org: institution || null,
        year: year || null,
      },
    );
    // Otimista: limpa o form imediatamente. Se add() falhar, o hook expõe
    // addError e o usuário pode tentar de novo. Mesmo padrão do vanilla
    // (modules/quals-courses.js linha 58).
    form.reset();
  }

  if (authLoading) {
    return (
      <section aria-labelledby="quals-heading">
        <h2 id="quals-heading" className="text-lg font-semibold mb-3">
          Formações
        </h2>
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section aria-labelledby="quals-heading">
        <h2 id="quals-heading" className="text-lg font-semibold mb-3">
          Formações
        </h2>
        <div className="text-center py-8 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)] mb-3">
            Entre pra cadastrar suas formações.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold"
          >
            Entrar
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="quals-heading">
      <h2 id="quals-heading" className="text-lg font-semibold mb-3">
        Formações
      </h2>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 mb-4 space-y-3"
      >
        <div>
          <label htmlFor="qual-title" className="block text-xs font-semibold mb-1">
            Título *
          </label>
          <input
            id="qual-title"
            name="title"
            type="text"
            required
            placeholder="Ex.: Técnico em Pintura Industrial"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="qual-institution"
            className="block text-xs font-semibold mb-1"
          >
            Instituição
          </label>
          <input
            id="qual-institution"
            name="institution"
            type="text"
            placeholder="Ex.: SENAI"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label htmlFor="qual-year" className="block text-xs font-semibold mb-1">
            Ano
          </label>
          <input
            id="qual-year"
            name="year"
            type="text"
            inputMode="numeric"
            placeholder="Ex.: 2024"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        {(submitError || addError) ? (
          <p className="text-xs text-red-600">
            {submitError || addError?.message || 'Erro ao salvar.'}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isAdding}
          className="w-full py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold disabled:opacity-50"
        >
          {isAdding ? 'Salvando...' : 'Adicionar formação'}
        </button>
      </form>

      {loading ? (
        <div className="space-y-2" aria-label="Carregando formações">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-6 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Não foi possível carregar as formações.
          </p>
        </div>
      ) : qualifications.length === 0 ? (
        <div className="text-center py-6 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhuma formação cadastrada ainda.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {qualifications.map((q) => (
            <QualRow key={q.id} q={q} onRemove={remove} removing={isRemoving} />
          ))}
        </ul>
      )}
    </section>
  );
}
