// Página /admin/reports — Server Component shell.
// RBAC é via RLS (Wave 18: policies SELECT/UPDATE só pra is_portal_admin()).
// Não-admin que acesse vê lista vazia + sem botão pra atualizar.

import type { Metadata } from 'next';
import { ReportsAdmin } from './ReportsAdmin';

export const metadata: Metadata = {
  title: 'Denúncias | QueroUmaCor Admin',
  description: 'Modera denúncias de conteúdo enviadas por usuários.',
};

export default function AdminReportsPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        Denúncias
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Lista de denúncias enviadas pelos usuários. Resolva ou dispense
        após verificar o conteúdo.
      </p>
      <ReportsAdmin />
    </main>
  );
}
