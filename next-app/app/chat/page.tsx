// Página /chat — Server Component shell.
// Equivalente à tela #screen-chat do vanilla (renderizada por loadChatList em
// modules/chat.js). Aqui o RSC só monta o layout estático; a parte interativa
// (lista, filtros, realtime, busca) vive em ChatList (client).
//
// Suspense boundary obrigatório porque ChatList usa useSearchParams() (deep-
// link ?nova=1 vindo do botão Orçar do feed). Sem o Suspense, Next 15 quebra
// o build com "useSearchParams() should be wrapped in a suspense boundary".

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChatList } from './ChatList';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Chat | QueroUmaCor',
  description: 'Suas conversas com clientes, pintores e a loja Cali Colors.',
};

function ChatListFallback() {
  return (
    <div className="space-y-2" aria-label="Carregando conversas">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)] animate-pulse"
        >
          <div className="w-12 h-12 rounded-full bg-[color:var(--color-border)]" />
          <div className="flex-1">
            <div className="h-3 w-3/4 bg-[color:var(--color-border)] rounded mb-2" />
            <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChatPage() {
  return (
    <AppShell>
      <div className="min-h-screen p-4 max-w-2xl mx-auto">
        <h1
          className="text-3xl font-bold mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Chat
        </h1>
        <Suspense fallback={<ChatListFallback />}>
          <ChatList />
        </Suspense>
      </div>
    </AppShell>
  );
}
