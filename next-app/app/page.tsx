import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
        QueroUmaCor
      </h1>
      <p className="text-lg mb-8 text-center max-w-md">
        Migração Next.js + TS + React em andamento. App vanilla original continua
        rodando em <a href="https://queroumacor.com.br" className="text-[color:var(--color-p1)] underline">queroumacor.com.br</a>.
      </p>
      <nav className="flex gap-4">
        <Link href="/login" className="px-6 py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold">
          Login
        </Link>
        <Link href="/info" className="px-6 py-3 border border-[color:var(--color-border)] rounded-xl font-semibold">
          Sobre
        </Link>
      </nav>
    </main>
  );
}
