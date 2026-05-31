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

export const metadata: Metadata = {
  title: 'Orçamento IA | QueroUmaCor',
  description:
    'Gere um orçamento de pintura completo com sugestão de escopo e preço pelo Seu Zé.',
};

export default function OrcamentoIaPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto pb-24">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Orçamento com IA
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Descreva o serviço, escolha a área e o Seu Zé sugere escopo e preço.
      </p>
      <QuoteWizard />
    </main>
  );
}
