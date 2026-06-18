// /explore — feed de trending (S12). Grid 3 colunas com top posts da
// última semana por score (likes + 3*comments).

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { TrendingGrid } from './TrendingGrid';

export const metadata: Metadata = {
  title: 'Em alta | QueroUmaCor',
  description: 'Posts mais curtidos e comentados da última semana.',
};

export default function ExplorePage() {
  return (
    <AppShell>
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          Em alta
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Top posts da última semana, ordenados por curtidas + comentários.
        </p>
        <TrendingGrid />
      </div>
    </AppShell>
  );
}
