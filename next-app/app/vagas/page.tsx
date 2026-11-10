// /vagas — mesma tela que o tile "Vagas" abre em bottom-sheet no perfil.
// Existe pra deep link (o aviso/push da loja pode apontar pra cá).

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { VagasView } from './VagasView';

export const metadata: Metadata = {
  title: 'Vagas para pintor | QueroUmaCor',
  description: 'Vagas de trabalho para pintores divulgadas pela Cali Colors.',
};

export default function VagasPage() {
  return (
    <AppShell>
      <div className="max-w-md mx-auto px-4 py-4">
        <VagasView />
      </div>
    </AppShell>
  );
}
