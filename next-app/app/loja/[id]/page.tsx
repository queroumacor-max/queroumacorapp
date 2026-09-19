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

import { AppShell } from '@/components/AppShell';
import { ProductDetail } from './ProductDetail';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages, que exigia o
// contrário; ver ADR 0006 e docs/adr/0006-workers-migration-artifacts.md).
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <AppShell>
      <div className="p-4">
        <ProductDetail id={id} />
      </div>
    </AppShell>
  );
}
