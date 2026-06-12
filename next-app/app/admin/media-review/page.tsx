// Página /admin/media-review — Server Component shell.
// RBAC é via RLS (Wave 29: policies SELECT/UPDATE/DELETE só pra
// is_portal_admin()). Não-admin que acesse vê lista vazia + mensagem.
//
// Esta fila é alimentada automaticamente por `/api/moderate` quando:
//   (1) o hash da mídia bate na blocklist → severity high/critical
//   (2) o Gemini retorna severity hard ou flagged + media → severity med/high

import type { Metadata } from 'next';
import { MediaReviewAdmin } from './MediaReviewAdmin';
import { requireAdminServer } from '@/lib/auth-server';

export const metadata: Metadata = {
  title: 'Fila de revisão de mídia | QueroUmaCor Admin',
  description:
    'Mídias enviadas pelos usuários que foram flagadas pela moderação automática.',
};

// CRIT-4 (audit 2026-06-12): guard server-side. Não-admin recebe 404.
export const dynamic = 'force-dynamic';

export default async function AdminMediaReviewPage() {
  await requireAdminServer();
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Revisão de mídia
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Mídias enviadas que foram automaticamente sinalizadas (hash batendo na
        deny-list ou Gemini flagou). Decida: aprovar, bloquear permanente, ou
        escalar pro NCMEC (CSAM).
      </p>
      <MediaReviewAdmin />
    </main>
  );
}
