// CoursesSection — client component que renderiza a lista de cursos +
// formulário inline pra adicionar um novo. Espelha o output de
// `loadCoursesList()` + UX de `addCourse()` em modules/quals-courses.js,
// porém na versão "simples" (só title + url opcional) — ver
// lib/services/formacao.ts AddCourseInput pra a justificativa.

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useCourses } from '@/lib/hooks/useCourses';
import type { Course } from '@/lib/services/formacao';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)] animate-pulse">
      <div className="w-10 h-10 rounded-lg bg-[color:var(--color-border)]" />
      <div className="flex-1">
        <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
      </div>
    </div>
  );
}

function CourseRow({
  c,
  onRemove,
  removing,
}: {
  c: Course;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  // O service expõe `link` (alias de `url` no input). Se o curso tem link,
  // o título vira um link externo abrindo em nova aba — UX consistente com
  // o que o vanilla faz no perfil público (modules/perfil.js renderiza com
  // <a href=link>).
  const titleNode = c.link ? (
    <a
      href={c.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block font-semibold text-sm truncate hover:underline"
    >
      {c.title || '(sem título)'}
    </a>
  ) : (
    <span className="block font-semibold text-sm truncate">
      {c.title || '(sem título)'}
    </span>
  );

  return (
    <li className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)]">
      <span
        className="w-10 h-10 rounded-lg bg-[color:var(--color-bg)] flex items-center justify-center text-lg flex-shrink-0"
        aria-hidden="true"
      >
        📚
      </span>
      <span className="flex-1 min-w-0">
        {titleNode}
        {c.link ? (
          <span className="block text-xs text-[color:var(--color-muted)] truncate">
            {c.link}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={() => onRemove(c.id)}
        disabled={removing}
        className="text-xs font-semibold text-red-600 disabled:opacity-50 px-2 py-1"
        aria-label={`Remover ${c.title || 'curso'}`}
      >
        Remover
      </button>
    </li>
  );
}

export function CoursesSection() {
  const { user, loading: authLoading } = useAuth();
  const {
    courses,
    loading,
    error,
    add,
    remove,
    isAdding,
    isRemoving,
    addError,
  } = useCourses();
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
    const url = String(fd.get('url') || '').trim();
    add({ title, url: url || null });
    form.reset();
  }

  if (authLoading) {
    return (
      <section aria-labelledby="courses-heading">
        <h2 id="courses-heading" className="text-lg font-semibold mb-3">
          Cursos
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
      <section aria-labelledby="courses-heading">
        <h2 id="courses-heading" className="text-lg font-semibold mb-3">
          Cursos
        </h2>
        <div className="text-center py-8 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)] mb-3">
            Entre pra cadastrar seus cursos.
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
    <section aria-labelledby="courses-heading">
      <h2 id="courses-heading" className="text-lg font-semibold mb-3">
        Cursos
      </h2>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 mb-4 space-y-3"
      >
        <div>
          <label htmlFor="course-title" className="block text-xs font-semibold mb-1">
            Título *
          </label>
          <input
            id="course-title"
            name="title"
            type="text"
            required
            placeholder="Ex.: Pintura Automotiva Avançada"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label htmlFor="course-url" className="block text-xs font-semibold mb-1">
            Link (opcional)
          </label>
          <input
            id="course-url"
            name="url"
            type="url"
            placeholder="https://..."
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
          {isAdding ? 'Salvando...' : 'Adicionar curso'}
        </button>
      </form>

      {loading ? (
        <div className="space-y-2" aria-label="Carregando cursos">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-6 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Não foi possível carregar os cursos.
          </p>
        </div>
      ) : courses.length === 0 ? (
        <div className="text-center py-6 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhum curso cadastrado ainda.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {courses.map((c) => (
            <CourseRow key={c.id} c={c} onRemove={remove} removing={isRemoving} />
          ))}
        </ul>
      )}
    </section>
  );
}
