// Página /loja — Server Component shell.
// Equivalente à `#screen-mkt` do vanilla (index.html linha 1505). RSC só
// monta o layout estático (heading + link pro carrinho); a parte interativa
// (fetch, filtros, grid) vive em ProductsList — client-side.
//
// Padrão alinhado com /pedidos e /leads: RSC dá HTML pronto pro crawler,
// e o client component hidrata o conteúdo dinâmico.

import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductsList } from './ProductsList';

export const metadata: Metadata = {
  title: 'Loja Cali Colors | QueroUmaCor',
  description:
    'Tintas, texturas, ferramentas e EPI pra pintura — entrega rápida.',
};

export default function LojaPage() {
  return (
    <main className="min-h-screen p-4 max-w-5xl mx-auto">
      <header className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Loja Cali Colors
          </h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Tintas, ferramentas e EPI pra pintor profissional
          </p>
        </div>
        <Link
          href="/loja/carrinho"
          className="px-4 py-2 bg-[color:var(--color-ink)] text-white rounded-xl text-sm font-semibold whitespace-nowrap"
        >
          🛒 Carrinho
        </Link>
      </header>
      <ProductsList />
    </main>
  );
}
