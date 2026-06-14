// Página /admin/reports — Server Component shell.
// RBAC é via RLS (Wave 18: policies SELECT/UPDATE só pra is_portal_admin())
// + guard server-side `requireAdminServer()` (CRIT-4 audit 2026-06-12) que
// retorna 404 pra não-admin antes do shell renderizar.

import type { Metadata } from 'next';
import { ReportsAdmin } from './ReportsAdmin';
import { requireAdminServer } from '@/lib/auth-server';

// Cloudflare Pages (next-on-pages) exige edge runtime explícito por rota.
export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Denúncias | QueroUmaCor Admin',
  description: 'Modera denúncias de conteúdo enviadas por usuários.',
};

// CRIT-4: guard cookie-based exige sessão do request → dynamic, não estático.
export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  // Guard server-side: não-admin recebe 404 antes do shell renderizar.
  // Defesa em profundidade — RLS no DB e gate client-side seguem ativos.
  await requireAdminServer();
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
