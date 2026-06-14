// Página /admin/flags — Server Component shell.
// RBAC final é via RLS no banco (`Admin manage flags` policy filtra UPDATE/INSERT
// pra `is_portal_admin()`). Aqui o RSC só monta layout + delega pro client
// component `FlagsAdmin`, que checa is_admin client-side pra dar feedback
// imediato ao usuário (não-admin vê tela "sem acesso" em vez de tentar editar
// e tomar 403).

import type { Metadata } from 'next';
import { FlagsAdmin } from './FlagsAdmin';
import { requireAdminServer } from '@/lib/auth-server';

// Cloudflare Pages (next-on-pages) exige edge runtime explícito por rota.
export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Feature Flags | QueroUmaCor Admin',
  description: 'Gerencia rollout de features experimentais.',
};

// CRIT-4 (audit 2026-06-12): guard server-side. Não-admin recebe 404.
export const dynamic = 'force-dynamic';

export default async function AdminFlagsPage() {
  await requireAdminServer();
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        Feature Flags
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Ligue/desligue features e controle rollout gradual por porcentagem.
        Mudanças são instantâneas — flags raramente cacheiam mais de 5min.
      </p>
      <FlagsAdmin />
    </main>
  );
}
