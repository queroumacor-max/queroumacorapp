import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Página não encontrada
        </h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          O link pode ter mudado ou a página não existe mais.
        </p>
        <Link
          href="/feed"
          className="inline-block px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: 'var(--color-p1)' }}
        >
          Voltar ao feed
        </Link>
      </div>
    </main>
  );
}
