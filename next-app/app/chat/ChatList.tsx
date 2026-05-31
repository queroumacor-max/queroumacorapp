// ChatList — client component que renderiza a lista lateral de conversas
// com tabs/filtros + botão "Nova conversa".
//
// Substitui chatTab/applyChatFilter/loadChatList do vanilla. O filtro é
// client-side puro (não refetch) — todas as conversas vêm de uma chamada
// só, e os tabs só filtram a lista exibida.
//
// useChatRealtime é montado AQUI (na lista) porque é o ponto único da árvore
// /chat onde sabemos que vai existir sessão ativa — atualizações chegam em
// background mesmo quando o user está em outra parte do /chat (conv aberta).

'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useConversations } from '@/lib/hooks/useChat';
import { useChatRealtime } from '@/lib/hooks/useChatRealtime';
import { ConversationItem } from './ConversationItem';
import { NewChatModal } from './NewChatModal';
import type { ConversationMeta } from '@/lib/services/chat';

type Tab = 'all' | 'trio' | 'store' | 'orcamento';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'trio', label: 'Trio' },
  { id: 'store', label: 'Loja' },
  { id: 'orcamento', label: 'Orçamentos' },
];

function matchesTab(c: ConversationMeta, tab: Tab): boolean {
  if (tab === 'all') return true;
  if (tab === 'trio') return c.is3way;
  if (tab === 'store') return c.isStore;
  if (tab === 'orcamento') {
    const t = (c.lastMsg + ' ' + c.name).toLowerCase();
    return /or[çc]ament/.test(t);
  }
  return false;
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-label="Carregando conversas">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border,#e5e5e5)] animate-pulse"
        >
          <div className="w-12 h-12 rounded-full bg-[color:var(--color-border,#e5e5e5)]" />
          <div className="flex-1">
            <div className="h-3 w-3/4 bg-[color:var(--color-border,#e5e5e5)] rounded mb-2" />
            <div className="h-2 w-1/2 bg-[color:var(--color-border,#e5e5e5)] rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatList() {
  const { user, loading: authLoading } = useAuth();
  const { conversations, loading, error } = useConversations();
  const [tab, setTab] = useState<Tab>('all');
  const [modalOpen, setModalOpen] = useState(false);

  // Realtime global — 1 subscription pra TODAS as conversas. Hook é idempotente.
  useChatRealtime(user?.id ?? null);

  const filtered = useMemo(
    () => conversations.filter((c) => matchesTab(c, tab)),
    [conversations, tab],
  );

  // IDs a excluir da busca de novos chats (evita criar conv duplicada).
  const excludeIds = useMemo(
    () =>
      conversations
        .map((c) => c.otherId)
        .filter((id): id is string => !!id),
    [conversations],
  );

  if (authLoading) return <Skeleton />;

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border,#e5e5e5)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          💬
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver suas conversas</h2>
        <p className="text-sm text-[color:var(--color-muted,#666)] mb-4">
          Suas conversas com clientes e pintores aparecem aqui depois do login.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1,#ff6a00)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Tabs + botão nova conversa */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex gap-1 overflow-x-auto flex-1" role="tablist">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={
                  'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ' +
                  (active
                    ? 'bg-[color:var(--color-ink,#111)] text-white'
                    : 'bg-white border border-[color:var(--color-border,#e5e5e5)] text-[color:var(--color-muted,#666)]')
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex-shrink-0 w-9 h-9 rounded-full bg-[color:var(--color-p1,#ff6a00)] text-white flex items-center justify-center text-lg font-bold"
          aria-label="Nova conversa"
        >
          +
        </button>
      </div>

      {loading ? (
        <Skeleton />
      ) : error ? (
        <div className="text-center py-10 rounded-xl bg-white border border-[color:var(--color-border,#e5e5e5)]">
          <p className="text-sm text-red-600" role="alert">
            Erro ao carregar conversas: {error.message}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border,#e5e5e5)]">
          <div className="text-5xl mb-3" aria-hidden="true">
            💬
          </div>
          <h2 className="font-semibold mb-2">
            {tab === 'all' ? 'Sem conversas ainda' : 'Nenhuma conversa nesta aba'}
          </h2>
          <p className="text-sm text-[color:var(--color-muted,#666)] mb-4">
            {tab === 'all'
              ? 'Suas conversas com clientes e pintores aparecem aqui. Inicie uma conversa pelo botão "+".'
              : 'Troque de aba ou inicie uma nova conversa.'}
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-block px-5 py-2 bg-[color:var(--color-p1,#ff6a00)] text-white rounded-xl font-semibold"
          >
            Nova conversa
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li key={c.convId}>
              <ConversationItem conv={c} />
            </li>
          ))}
        </ul>
      )}

      <NewChatModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        excludeIds={excludeIds}
      />
    </div>
  );
}
