// Página /admin/products/[id] — editor de variantes pra UM produto.

import type { Metadata } from 'next';
import { ProductEditor } from './ProductEditor';

interface Params { id: string }

export const metadata: Metadata = {
  title: 'Editar produto | QueroUmaCor Admin',
};

export default async function AdminProductPage({
  params,
}: { params: Promise<Params> }) {
  const { id } = await params;
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <ProductEditor productId={id} />
    </main>
  );
}
