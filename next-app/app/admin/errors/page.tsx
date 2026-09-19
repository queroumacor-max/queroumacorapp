// Página /admin/errors — Server Component shell do dashboard caseiro de
// erros (tabela `errors`, alimentada pelo /api/log-error). A API
// `/api/admin/errors-list` já existia desde a migração; esta PÁGINA tinha
// ficado pra trás no vanilla — referências antigas a "/admin/errors"
// apontavam pro nada (2026-08-28).
// RBAC: `requireAdminServer()` (CRIT-4) devolve 404 pra não-admin antes do
// shell renderizar; a API revalida token + ADMIN_EMAILS por conta própria.

import type { Metadata } from 'next';
import { ErrorsAdmin } from './ErrorsAdmin';
import { requireAdminServer } from '@/lib/auth-server';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages, que exigia o
// contrário; ver ADR 0006 e docs/adr/0006-workers-migration-artifacts.md).
export const runtime = 'nodejs';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Erros | QueroUmaCor Admin',
  description: 'Dashboard de erros do cliente (log-error).',
};

// CRIT-4: guard cookie-based exige sessão do request → dynamic, não estático.
export const dynamic = 'force-dynamic';

export default async function AdminErrorsPage() {
  await requireAdminServer();
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        Erros
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Registros enviados pelo app via <code>/api/log-error</code>: exceções
        JS, Web Vitals e diagnósticos (<code>scrollpin-diag</code>,{' '}
        <code>sw-nav-5xx</code>).
      </p>
      <ErrorsAdmin />
    </main>
  );
}
