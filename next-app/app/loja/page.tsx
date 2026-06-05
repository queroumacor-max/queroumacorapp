// Página /loja — Server Component shell.
// Equivalente à `#screen-mkt` do vanilla (index.html linha 1505). Todo o
// layout (header dark sticky + tabs + busca + cards) fica no ProductsList
// porque o header precisa de state pra sticky+busca interativos.

import type { Metadata } from 'next';
import { ProductsList } from './ProductsList';
import { AliceFab } from './AliceFab';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Loja Cali Colors | QueroUmaCor',
  description:
    'Tintas, texturas, ferramentas e EPI pra pintura — entrega rápida.',
};

export default function LojaPage() {
  return (
    <AppShell>
      <ProductsList />
      <AliceFab />
    </AppShell>
  );
}
