// Página /admin/whatsapp — Server Component shell (SQL Wave 38).
// Conversas do número oficial da Cali Colors via WhatsApp Cloud API:
// lista mensagens recebidas/enviadas (tabela `whatsapp_messages`, RLS
// admin-only) + formulário de envio via /api/whatsapp/send.

import type { Metadata } from 'next';
import { WhatsAppAdmin } from './WhatsAppAdmin';
import { requireAdminServer } from '@/lib/auth-server';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages, que exigia o
// contrário; ver ADR 0006 e docs/adr/0006-workers-migration-artifacts.md).
export const runtime = 'nodejs';

export const metadata: Metadata = {
  // Página autenticada — fora do índice de busca.
  robots: { index: false, follow: false },
  title: 'WhatsApp | QueroUmaCor Admin',
  description: 'Mensagens do número oficial da Cali Colors (WhatsApp Cloud API).',
};

// CRIT-4: guard cookie-based exige sessão do request → dynamic, não estático.
export const dynamic = 'force-dynamic';

export default async function AdminWhatsAppPage() {
  // Guard server-side: não-admin recebe 404 antes do shell renderizar.
  // Defesa em profundidade — RLS no DB e gate client-side seguem ativos.
  await requireAdminServer();
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        WhatsApp
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Conversas do número oficial (+55 11 95976-5031) via Cloud API.
        Texto livre só entrega pra quem escreveu nas últimas 24h — fora da
        janela, use um template aprovado no WhatsApp Manager.
      </p>
      <WhatsAppAdmin />
    </main>
  );
}
