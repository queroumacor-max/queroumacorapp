// ChatList — lista de conversas com tabs/filtros + arquivadas colapsável +
// "+ Nova". Atalho ?orcamento=1&to=<userId> abre o NewChatModal já no
// fluxo de orçamento (vanilla abrirOrcamentoChat).
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useConversations } from '@/lib/hooks/useChat';
import { useChatRealtime } from '@/lib/hooks/useChatRealtime';
import { useArchivedConvs } from '@/lib/hooks/useArchivedConvs';
import { ConversationItem } from './ConversationItem';
import { NewChatModal } from './NewChatModal';
import type { ConversationMeta } from '@/lib/services/chat';

type Tab = 'all' | 'trio' | 'store' | 'orcamento';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'orcamento', label: 'Orçamentos' },
  { id: 'trio', label: 'Pintor + Cali 🔗' },
  { id: 'store', label: 'Cali Colors' },
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { conversations, loading, error } = useConversations();
  const { archivedSet } = useArchivedConvs();
  const [tab, setTab] = useState<Tab>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Realtime global — 1 subscription pra TODAS as conversas. Hook é idempotente.
  useChatRealtime(user?.id ?? null);

  // Deep-link: ?to=<userId>&orcamento=1 vindo do botão "Orçar" do feed.
  // Abre o NewChatModal já filtrando esse user (NewChatModal aceita
  // pre-fill por searchParams indireto — se a UX pedir, expandimos depois).
  // Por enquanto, garantimos que o modal abre se o param `nova=1` existir.
  useEffect(() => {
    const nova = searchParams?.get('nova');
    if (nova === '1') setModalOpen(true);
  }, [searchParams]);

  // Separa arquivadas das ativas + aplica filtro do tab nas ativas.
  const active = useMemo(
    () => conversations.filter((c) => !archivedSet.has(c.convId) && matchesTab(c, tab)),
    [conversations, archivedSet, tab],
  );
  const archived = useMemo(
    () => conversations.filter((c) => archivedSet.has(c.convId) && matchesTab(c, tab)),
    [conversations, archivedSet, tab],
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

  function closeAndCleanUrl() {
    setModalOpen(false);
    // Se veio com ?nova=1 / ?orcamento=1 / ?to=..., limpa pra não reabrir
    // ao re-render.
    if (searchParams?.get('nova') === '1' || searchParams?.get('orcamento') === '1') {
      router.replace('/chat');
    }
  }

  return (
    <div>
      {/* Tabs + botão nova conversa */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex gap-1 overflow-x-auto flex-1 hide-scrollbar" role="tablist">
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
      ) : active.length === 0 && archived.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border,#e5e5e5)]">
          <div className="text-5xl mb-3" aria-hidden="true">💬</div>
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
        <>
          {active.length > 0 ? (
            <ul className="space-y-2">
              {active.map((c) => (
                <li key={c.convId}>
                  <ConversationItem conv={c} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-sm text-[color:var(--color-muted)] py-6">
              Nenhuma conversa ativa nesta aba.
            </p>
          )}

          {archived.length > 0 ? (
            <div style={{ marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--color-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                aria-expanded={showArchived}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
                <span>Arquivadas</span>
                <span style={{ fontSize: 11, fontWeight: 500 }}>
                  ({archived.length})
                </span>
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  style={{
                    marginLeft: 'auto',
                    transform: showArchived ? 'rotate(180deg)' : 'none',
                    transition: 'transform .15s',
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showArchived ? (
                <ul className="space-y-2" style={{ marginTop: 6 }}>
                  {archived.map((c) => (
                    <li key={c.convId}>
                      <ConversationItem conv={c} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <NewChatModal
        open={modalOpen}
        onClose={closeAndCleanUrl}
        excludeIds={excludeIds}
      />
    </div>
  );
}
