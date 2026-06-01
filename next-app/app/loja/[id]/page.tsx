// /loja/[id] — página de detalhe de produto.
// Equivalente ao modal `openProductDetail` do vanilla (modules/mkt.js
// linhas 496-524). Como é uma rota dedicada (não modal), também faz papel
// de SEO/share — RSC monta o shell e o ProductDetail (client) puxa os
// dados via useProduct + permite adicionar ao carrinho.
//
// Não usamos `generateMetadata` dinâmico aqui pra evitar fetch dobrado
// (RSC fetch + client fetch). Quando o catálogo virar relativamente
// estático, dá pra adicionar metadata server-side com fetch separado.
//
// Next.js 15: `params` é Promise — precisa `await` dentro de Server Component.

import { ProductDetail } from './ProductDetail';

// Cloudflare Pages via @cloudflare/next-on-pages: rotas dinâmicas precisam
// edge runtime (Node runtime não está disponível em CF Pages Functions).
export const runtime = 'edge';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <ProductDetail id={id} />
    </main>
  );
}
