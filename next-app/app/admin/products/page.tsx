// Página /admin/products — Server Component shell. Lista compacta com busca
// pro admin escolher um produto e editar variantes em /admin/products/[id].
// RLS gateia escritas; UI faz client-gate só pra feedback de "Acesso restrito".

import type { Metadata } from 'next';
import { ProductsAdminList } from './ProductsAdminList';

export const metadata: Metadata = {
  title: 'Produtos | QueroUmaCor Admin',
  description: 'Gerencia variantes de tamanho dos produtos da loja.',
};

export default function AdminProductsPage() {
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
