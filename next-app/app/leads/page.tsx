// Página /leads — Server Component shell.
// Equivalente à listagem de posts com `for_sale=true` que o vanilla mostra
// dentro do feed principal (modules/leads.js). Aqui é tela dedicada: RSC
// monta o layout estático (heading + subtítulo + main); a parte interativa
// (fetch, mutation de comprar, estados) vive em LeadsList — client-side.
//
// Por que separar? Mesmo padrão de pedidos/notificacoes: RSC dá HTML pronto
// pro crawler/preview, e o client component só hidrata o conteúdo dinâmico.
//
// Gating PRO: a tela está propositalmente ABERTA pra qualquer logado por
// agora — o spec pediu "PRO-gated mas pra agora deixa aberto". Quando ligar,
// o gate vai aqui (RSC pode ler cookies/profile e renderizar paywall) OU
// dentro do LeadsList (UX mais granular). A RPC create_painter_draft é onde
// a checagem definitiva acontece no banco, então mesmo sem gate visual a
// compra é segura.

import type { Metadata } from 'next';
import { LeadsList } from './LeadsList';

export const metadata: Metadata = {
  title: 'Leads | QueroUmaCor',
  description:
    'Oportunidades de obra pra pintores — compre acesso aos contatos.',
};

export default function LeadsPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Leads
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Oportunidades de obra pra você
      </p>
      <LeadsList />
    </main>
  );
}
