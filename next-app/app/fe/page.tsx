// Página /fe — assistente IA pro grafiteiro/muralista. Espelha estrutura
// do /seu-ze (RSC shell + client component).

import type { Metadata } from 'next';
import { FeChat } from './FeChat';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Fê | QueroUmaCor',
  description:
    'Assistente IA pra grafiteiro e muralista — spray, técnica, mural, preço, legalidade. Chat por texto ou voz.',
};

export default function FePage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-3xl mx-auto pb-24">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Fê
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Seu irmão da cena. Manda dúvida sobre spray, técnica, mural, preço.
      </p>
      <FeChat />
    </div></AppShell>
  );
}
