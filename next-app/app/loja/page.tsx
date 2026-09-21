// Página /loja — Server Component shell.
// Equivalente à `#screen-mkt` do vanilla (index.html linha 1505). Todo o
// layout (seleção de loja + header dark sticky + tabs + busca + cards)
// fica no LojaShell/ProductsList porque precisa de state interativo.

import type { Metadata } from 'next';
import { LojaShell } from './LojaShell';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Loja Cali Colors | QueroUmaCor',
  description:
    'Tintas, texturas, ferramentas e EPI pra pintura — entrega rápida.',
};

export default function LojaPage() {
  return (
    <AppShell>
      <LojaShell />
    </AppShell>
  );
}
