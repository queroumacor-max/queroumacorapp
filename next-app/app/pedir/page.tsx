// /pedir — página PÚBLICA "Precisa de pintor?" (2026-11-10). É o link que a
// equipe cola em grupo de moradores, no QR da loja e em anúncio. NÃO usa
// AppShell (ele exige login); o pedido cai no portal ("Pedidos de pintor").
//
// `?cidade=Osasco` troca a cidade do título e do formulário; `?o=facebook`
// marca de onde a pessoa veio.

import type { Metadata } from 'next';
import { PedirForm } from './PedirForm';

export const metadata: Metadata = {
  title: 'Precisa de pintor? Peça orçamento grátis | QueroUmaCor',
  description:
    'Conte o serviço de pintura que você precisa e receba o contato de pintores avaliados da sua região. Grátis, pela Cali Colors.',
  alternates: { canonical: 'https://www.queroumacor.com.br/pedir' },
};

// Lê a query NO SERVIDOR (em vez de `useSearchParams` + Suspense no cliente):
// o formulário já sai no HTML — quem chega com rede ruim vê a página antes
// do JS, e o Google lê o título com a cidade.
export default async function PedirPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
  const cidade = um(q.cidade).replace(/[<>]/g, '').trim().slice(0, 80);
  const origem = um(q.o).slice(0, 40);
  return (
    <main className="min-h-[100dvh] bg-[color:var(--color-bg)]">
      <header className="bg-[color:var(--color-ink-fixed)] px-4 py-3">
        <div className="max-w-md mx-auto font-bold text-[color:var(--color-white-fixed)]" style={{ fontFamily: 'var(--font-display)' }}>
          QueroUmaCor
        </div>
      </header>
      <div className="max-w-md mx-auto px-4 py-5">
        <PedirForm cidadeInicial={cidade} origem={origem} />
      </div>
    </main>
  );
}
