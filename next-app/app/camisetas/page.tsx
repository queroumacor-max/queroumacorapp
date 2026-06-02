// /camisetas — Server Component shell pra catálogo de camisetas
// personalizadas. Espelha `#screen-camisetas` do vanilla (index.html
// linha 1539). RSC monta o título; ShirtCustomizer (client) cuida da
// customização + add-to-cart.

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShirtCustomizer } from './ShirtCustomizer';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Camisetas personalizadas | QueroUmaCor',
  description:
    'Camisetas profissionais com seu logo — escolha cor, tamanho e quantidade.',
};

export default function CamisetasPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-3xl mx-auto">
      <header className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Camisetas personalizadas
          </h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Vista sua marca — desconto progressivo a partir de 5 unidades
          </p>
        </div>
        <Link
          href="/loja/carrinho"
          className="px-4 py-2 bg-[color:var(--color-ink)] text-white rounded-xl text-sm font-semibold whitespace-nowrap"
        >
          🛒 Carrinho
        </Link>
      </header>
      <ShirtCustomizer />
    </div></AppShell>
  );
}
