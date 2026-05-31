// Página /chat — Server Component shell.
// Equivalente à tela #screen-chat do vanilla (renderizada por loadChatList em
// modules/chat.js). Aqui o RSC só monta o layout estático; a parte interativa
// (lista, filtros, realtime, busca) vive em ChatList (client).

import type { Metadata } from 'next';
import { ChatList } from './ChatList';

export const metadata: Metadata = {
  title: 'Chat | QueroUmaCor',
  description: 'Suas conversas com clientes, pintores e a loja Cali Colors.',
};

export default function ChatPage() {
  return (
    <main className="min-h-screen p-4 max-w-2xl mx-auto">
      <h1
        className="text-3xl font-bold mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Chat
      </h1>
      <ChatList />
    </main>
  );
}
