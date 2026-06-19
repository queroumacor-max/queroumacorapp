// Página /chat/[convId] — Server Component shell pra uma conversa específica.
// O convId vem da URL (encoded). Toda interatividade vai pra ChatConversation
// (client), que tem header, lista de mensagens, composer e realtime.

import type { Metadata } from 'next';
import { ChatConversation } from './ChatConversation';
import { AppShell } from '@/components/AppShell';

// Cloudflare Pages via @cloudflare/next-on-pages: rotas dinâmicas precisam
// edge runtime (Node runtime não está disponível em CF Pages Functions).
export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Conversa | QueroUmaCor',
};

interface PageProps {
  params: Promise<{ convId: string }>;
}

export default async function ConversationPage({ params }: PageProps) {
  const { convId } = await params;
  // Next 15 codifica path params na URL, então decodificamos aqui pra que o
  // hook receba o convId real (que pode conter ':' do prefix 3way: ou '_').
  const decoded = decodeURIComponent(convId);
  // Embrulhado em AppShell pra manter TopNav (topo) + BottomNav (rodapé) em
  // todas as telas, inclusive a conversa — antes a conversa renderizava um
  // <main> solto e o chrome global sumia. O header próprio da conversa
  // (voltar + perfil do interlocutor) fica como barra secundária dentro.
  return (
    <AppShell>
      <ChatConversation convId={decoded} />
    </AppShell>
  );
}
