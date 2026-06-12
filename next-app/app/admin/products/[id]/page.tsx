// Página /admin/products/[id] — editor de variantes pra UM produto.
// CRIT-4 (audit 2026-06-12): guard server-side. Não-admin recebe 404.

import type { Metadata } from 'next';
import { ProductEditor } from './ProductEditor';
import { requireAdminServer } from '@/lib/auth-server';

interface Params { id: string }

export const metadata: Metadata = {
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
