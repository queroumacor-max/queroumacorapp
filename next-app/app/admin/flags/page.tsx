// Página /admin/flags — Server Component shell.
// RBAC final é via RLS no banco (`Admin manage flags` policy filtra UPDATE/INSERT
// pra `is_portal_admin()`). Aqui o RSC só monta layout + delega pro client
// component `FlagsAdmin`, que checa is_admin client-side pra dar feedback
// imediato ao usuário (não-admin vê tela "sem acesso" em vez de tentar editar
// e tomar 403).

import type { Metadata } from 'next';
import { FlagsAdmin } from './FlagsAdmin';

export const metadata: Metadata = {
  title: 'Feature Flags | QueroUmaCor Admin',
  description: 'Gerencia rollout de features experimentais.',
};

export default function AdminFlagsPage() {
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
