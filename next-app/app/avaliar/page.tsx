// /avaliar — tela de avaliação pós-obra. Cliente avalia pintor após
// quote ser marcada como concluida.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { AvaliarView } from './AvaliarView';

export const metadata: Metadata = {
  title: 'Avaliar serviço | QueroUmaCor',
  description: 'Avalie o pintor após a conclusão do serviço.',
};

export default function AvaliarPage() {
  return (
    <AppShell>
      <main className="p-4 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          Avaliar serviço
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mb-6">
          Sua avaliação ajuda outros clientes a escolherem melhor.
        </p>
        <AvaliarView />
      </main>
    </AppShell>
  );
}
