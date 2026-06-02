// Página /notificacoes — Server Component shell.
// Equivalente à tela `#screen-notif` do vanilla (rendered por loadNotifications
// em modules/notif.js). Aqui o RSC só monta o layout estático (heading + main);
// toda a parte interativa (fetch, realtime, mark-as-read) vive em
// NotificationsList, que é client-side e usa useNotifications().
//
// Por que separar? RSC dá HTML pronto pra crawler/preview do WhatsApp, e o
// client component só hidrata o conteúdo dinâmico — o usuário vê o título
// imediatamente enquanto o fetch das notificações roda em background.

import type { Metadata } from 'next';
import { NotificationsList } from './NotificationsList';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Notificações | QueroUmaCor',
  description: 'Suas curtidas, comentários, novos seguidores e avisos do app.',
};

export default function NotificacoesPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6" style={{ fontFamily: 'var(--font-display)' }}>
        Notificações
      </h1>
      <NotificationsList />
    </div></AppShell>
  );
}
