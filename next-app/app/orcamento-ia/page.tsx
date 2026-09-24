// Página /orcamento-ia — Server Component shell.
// Equivalente ao modal `#ai-orc-modal` do vanilla (openAiOrcamento +
// gerarOrcamentoIA em modules/ai-chat.js). Aqui é wizard dedicado em vez de
// modal: o RSC monta o layout estático; o client (QuoteWizard) cuida do
// formulário multi-etapa + chamada IA.
//
// Gating PRO: mesma estratégia de /seu-ze — gate visual em client, gate
// definitivo em /api/chat-ai e /api/pricing-suggest (server-side).

import type { Metadata } from 'next';
import { QuoteWizard } from './QuoteWizard';
import { AppShell } from '@/components/AppShell';
import { lerReabertura } from '@/lib/orcamentoModelo';

export const metadata: Metadata = {
  // Página autenticada — fora do índice de busca.
  robots: { index: false, follow: false },
  title: 'Orçamento IA | QueroUmaCor',
  description:
    'Gere um orçamento de pintura completo com sugestão de escopo e preço pelo Seu Zé.',
};

export default async function OrcamentoIaPage({
  searchParams,
}: {
  searchParams: Promise<{ base?: string | string[]; modo?: string | string[] }>;
}) {
  // Editar / duplicar um orçamento do pipeline: `?base=<id>&modo=editar|duplicar`.
  const sp = await searchParams;
  const reabrir = lerReabertura(sp.base, sp.modo);
  return (
    <AppShell><div className="min-h-full p-4 max-w-3xl mx-auto pb-24">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Orçamento com IA
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Descreva o serviço, escolha a área e o Seu Zé sugere escopo e preço.
      </p>
      <QuoteWizard key={reabrir ? `${reabrir.modo}:${reabrir.baseId}` : 'novo'} baseId={reabrir?.baseId} modo={reabrir?.modo} />
    </div></AppShell>
  );
}
