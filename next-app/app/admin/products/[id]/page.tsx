// Página /admin/products/[id] — editor de variantes pra UM produto.
// CRIT-4 (audit 2026-06-12): guard server-side. Não-admin recebe 404.

import type { Metadata } from 'next';
import { ProductEditor } from './ProductEditor';
import { requireAdminServer } from '@/lib/auth-server';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages, que exigia o
// contrário; ver ADR 0006 e docs/adr/0006-workers-migration-artifacts.md).
export const runtime = 'nodejs';

interface Params { id: string }

export const metadata: Metadata = {
  // Página autenticada — fora do índice de busca.
  robots: { index: false, follow: false },
  title: 'Editar produto | QueroUmaCor Admin',
};

export const dynamic = 'force-dynamic';

export default async function AdminProductPage({
  params,
}: { params: Promise<Params> }) {
  await requireAdminServer();
  const { id } = await params;
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <ProductEditor productId={id} />
    </main>
  );
}
