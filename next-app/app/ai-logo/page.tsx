// Página /ai-logo — Server Component shell ("Gerador de Logo IA").
// Equivalente ao modal `#ai-logo-modal` do vanilla (modules/ai-logo.js:
// gerarLogoIA + UI inline). Mesmo padrão dos outros shells (arte-ig,
// pedidos, formacao): RSC dá HTML pronto pra crawler/preview, e o client
// component (LogoStudio) hidrata todo o conteúdo dinâmico (form, geração,
// preview de variants, salvar/baixar/aplicar na camiseta).
//
// O gate "PRO + 1ª grátis vs paga" vive no client (useAiLogo expõe
// `isFirstFree`/`genCount`) porque depende da sessão Supabase e do contador
// de gerações da sessão. O servidor backend (gateProAI em /api/generate-logo)
// é fonte de verdade final; se alguém burlar o gate visual, request → 403/429.

import type { Metadata } from 'next';
import { LogoStudio } from './LogoStudio';

export const metadata: Metadata = {
  title: 'Gerador de Logo IA | QueroUmaCor',
  description:
    'Gere seu logo profissional com a IA Seu Zé — 4 variants, escolha o seu, aplique na camiseta e salve no perfil.',
};

export default function AiLogoPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Logo da sua marca
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Nome + estilo → 4 variants em segundos. 1ª geração grátis; reroll por R$ 1,99.
      </p>
      <LogoStudio />
    </main>
  );
}
