// /perfil/bloqueados — lista usuários bloqueados, permite desbloquear.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { BlockedList } from './BlockedList';

export const metadata: Metadata = {
  title: 'Bloqueados | QueroUmaCor',
};

export default function BloqueadosPage() {
  return (
    <AppShell>
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          Usuários bloqueados
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Bloqueados não aparecem no seu feed, busca ou notificações. Eles
          ainda podem ver seu perfil público se acessarem direto.
        </p>
        <BlockedList />
      </div>
    </AppShell>
  );
}
