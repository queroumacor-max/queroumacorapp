// Página /admin/feature-interest — RSC shell. RBAC via RLS (Wave 19:
// SELECT só pra is_portal_admin()). Não-admin vê lista vazia.

import type { Metadata } from 'next';
import { FeatureInterestAdmin } from './FeatureInterestAdmin';

export const metadata: Metadata = {
  title: 'Interesse em features | QueroUmaCor Admin',
  description: 'Métrica de cliques em features "em breve" (Maquininha etc.).',
};

export default function AdminFeatureInterestPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        Interesse em features
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Quantos usuários clicaram em "tenho interesse" em features que
        ainda não estão disponíveis. Use pra priorizar lançamentos.
      </p>
      <FeatureInterestAdmin />
    </main>
  );
}
