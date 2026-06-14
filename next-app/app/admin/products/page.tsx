// Página /admin/products — Server Component shell. Lista compacta com busca
// pro admin escolher um produto e editar variantes em /admin/products/[id].
// RLS gateia escritas; UI faz client-gate só pra feedback de "Acesso restrito".

import type { Metadata } from 'next';
import { ProductsAdminList } from './ProductsAdminList';
import { requireAdminServer } from '@/lib/auth-server';

// Cloudflare Pages (next-on-pages) exige edge runtime explícito por rota.
export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Produtos | QueroUmaCor Admin',
  description: 'Gerencia variantes de tamanho dos produtos da loja.',
};

// CRIT-4 (audit 2026-06-12): guard server-side. Não-admin recebe 404.
export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  await requireAdminServer();
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        Produtos
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Busque um produto pelo nome ou código e clique pra editar variantes
        de tamanho (quartinho/galão/lata).
      </p>
      <ProductsAdminList />
    </main>
  );
}
