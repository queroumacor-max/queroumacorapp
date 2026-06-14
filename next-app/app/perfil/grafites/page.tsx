// /perfil/grafites — biblioteca de artes do pintor/grafiteiro. Sprint 1
// da feature AR Grafite. Aqui o user sobe imagens, define título/tags
// e (sprint 2) abre cada uma no WallARView em modo overlay.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { ArtLibrary } from './ArtLibrary';

export const metadata: Metadata = {
  title: 'Minhas artes | QueroUmaCor',
  description: 'Biblioteca de referências pra projetar em AR na parede.',
};

export default function GrafitesPage() {
  return (
    <AppShell>
      <main className="p-4 max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          Minhas artes
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mb-6">
          Suba imagens uma vez e reuse em várias paredes. Toque em
          “Projetar na parede” pra ver a arte em AR, com controle de opacidade.
        </p>
        <ArtLibrary />
      </main>
    </AppShell>
  );
}
