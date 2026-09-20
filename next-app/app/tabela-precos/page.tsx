// Página /tabela-precos — mesma tela que o tile "Tabela de Preços" abre em
// bottom-sheet no perfil. A rota existe pra deep link (dá pra mandar o link
// no chat) e pra quem prefere tela cheia.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { TabelaPrecosView } from './TabelaPrecosView';

export const metadata: Metadata = {
  title: 'Tabela de Preços de Pintura | QueroUmaCor',
  description:
    'Sugestão de preços de pintura 2026: mão de obra por m², metro linear, peça e diária, com faixas mínima, média e máxima.',
};

export default function TabelaPrecosPage() {
  return (
    <AppShell>
      <TabelaPrecosView />
    </AppShell>
  );
}
