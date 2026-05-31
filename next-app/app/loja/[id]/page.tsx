// /loja/[id] — página de detalhe de produto.
// Equivalente ao modal `openProductDetail` do vanilla (modules/mkt.js
// linhas 496-524). Como é uma rota dedicada (não modal), também faz papel
// de SEO/share — RSC monta o shell e o ProductDetail (client) puxa os
// dados via useProduct + permite adicionar ao carrinho.
//
// Não usamos `generateMetadata` dinâmico aqui pra evitar fetch dobrado
// (RSC fetch + client fetch). Quando o catálogo virar relativamente
// estático, dá pra adicionar metadata server-side com fetch separado.

import { ProductDetail } from './ProductDetail';

export default function ProductPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <ProductDetail id={params.id} />
    </main>
  );
}
