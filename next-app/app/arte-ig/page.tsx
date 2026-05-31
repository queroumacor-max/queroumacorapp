// Página /arte-ig — Server Component shell ("Arte pra Instagram").
// Equivalente ao modal `ai-art-modal` do vanilla (modules/ai-art.js:
// openAiArt). Mesmo padrão dos outros shells (financeiro/agenda/pedidos):
// RSC dá HTML pronto pra crawler/preview, e o client component (AiArtStudio)
// hidrata todo o conteúdo dinâmico (upload, seleção, geração, ações).
//
// O gate "PRO + créditos 5/dia free" vive no client (canSeeProFeature +
// useAiArt.creditsLeft) porque depende de localStorage (créditos) E de
// user_metadata.is_pro (sessão Supabase) — ambos só disponíveis no browser.
// O servidor backend (gateProAI em /api/ig-art) é fonte da verdade final;
// se alguém burlar o gate visual, a request é rejeitada com 403/429.

import type { Metadata } from 'next';
import { AiArtStudio } from './AiArtStudio';

export const metadata: Metadata = {
  title: 'Arte pra Instagram | QueroUmaCor',
  description:
    'Sua foto vira post estilizado pro Instagram com a IA Seu Zé — escolha o estilo, gere e poste.',
};

export default function ArteIgPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Arte pra Instagram
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Foto sua + estilo → arte pronta com legenda em segundos. PRO ou 5 grátis
        por dia.
      </p>
      <AiArtStudio />
    </main>
  );
}
