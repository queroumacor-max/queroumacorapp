// Página /senna — assistente IA pro funileiro/automotivo. Espelha
// estrutura do /seu-ze (RSC shell + client component).

import type { Metadata } from 'next';
import { SennaChat } from './SennaChat';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Senna | QueroUmaCor',
  description:
    'Assistente IA pra funileiro e pintor automotivo — PU 2K, primer, verniz, lanternagem, polimento. Chat por texto ou voz.',
};

export default function SennaPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-3xl mx-auto pb-24">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Senna
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Mestre da oficina. Pergunte sobre tinta, lanternagem, polimento,
        ceramic coating.
      </p>
      <SennaChat />
    </div></AppShell>
  );
}
