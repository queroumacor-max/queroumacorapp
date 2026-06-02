// Página /pontos — espelha o `#points-modal` do vanilla (index.html
// linha 2012+ + modules/points-refs.js). Mostra saldo, botão de troca
// (100 pts → 1 mês PRO via RPC), tabela "como ganhar", e histórico
// das últimas 20 transações.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { PontosView } from './PontosView';

export const metadata: Metadata = {
  title: 'Meus Pontos | QueroUmaCor',
  description: 'Saldo de pontos e troca por mês PRO extra.',
};

export default function PontosPage() {
  return (
    <AppShell>
      <PontosView />
    </AppShell>
  );
}
