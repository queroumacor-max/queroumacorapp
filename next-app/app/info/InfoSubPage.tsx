// Layout compartilhado das sub-páginas /info/* — header com botão voltar +
// container max-w + paddings. Mantém a mesma chrome do /info pra
// continuidade visual. Cada sub-rota renderiza seu conteúdo dentro.
import Link from 'next/link';
import type { ReactNode } from 'react';

export function InfoSubPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[color:var(--color-bg)] pb-24">
      <header className="bg-white border-b border-[color:var(--color-border)] px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <Link
          href="/info"
          aria-label="Voltar"
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[color:var(--color-bg)] text-[color:var(--color-ink)] text-xl"
        >
          ‹
        </Link>
        <h1
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
      </header>
      <div className="max-w-2xl mx-auto p-4">
        <article
          className="bg-white rounded-2xl p-5 shadow-sm"
          style={{ lineHeight: 1.65 }}
        >
          {children}
        </article>
      </div>
    </main>
  );
}

// Estilos compartilhados pros componentes filhos. Espelha .leg-h / .leg-p /
// .leg-upd / .faq-q / .faq-a do styles.css vanilla.
export function LegalH({ children }: { children: ReactNode }) {
  return (
    <h2
      className="font-bold mt-5 mb-2"
      style={{
        fontSize: 15,
        fontFamily: 'var(--font-display)',
        color: 'var(--color-ink)',
      }}
    >
      {children}
    </h2>
  );
}

export function LegalP({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 13.5,
        color: 'var(--color-ink)',
        marginBottom: 10,
        lineHeight: 1.65,
      }}
    >
      {children}
    </p>
  );
}

export function LegalUpd({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 11,
        color: 'var(--color-muted)',
        marginBottom: 14,
        fontStyle: 'italic',
      }}
    >
      {children}
    </p>
  );
}

export function FaqItem({
  q,
  a,
}: {
  q: string;
  a: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        className="font-bold"
        style={{
          fontSize: 14,
          color: 'var(--color-ink)',
          marginBottom: 4,
        }}
      >
        {q}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--color-ink)', lineHeight: 1.6 }}>
        {a}
      </div>
    </div>
  );
}
