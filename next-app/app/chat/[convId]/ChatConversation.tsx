// ChatConversation — orquestra header + lista + composer + realtime pra uma
// conversa específica. Substitui o openChat(convId) imperativo do vanilla.
//
// Resolução de receiver:
//  - Heurística do convId: 1:1 → strip do prefix 3way: e pega o outro UUID
//    do par sorted; 3-way → pintor é o outro UUID, mas o "receiver" no INSERT
//    é o pintor mesmo (loja é o agente Cali Colors, recebe via Realtime).
//  - storeId vem do useCalicolorsId pra pintar bolha 'store' nas msgs do
//    Cali Colors quando elas chegarem por realtime.
//
// Realtime: o hook GLOBAL useChatRealtime (montado em ChatList) já cuida do
// append no cache. Aqui só lemos via useMessages — não precisamos do hook
// novamente. Mas, se o user entrou direto no /chat/[convId] sem passar por
// /chat (deeplink), o hook global não foi instalado → montamos aqui também.
// useEffect cleanup garante que não duplica subscriptions.

'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import {
  useMessages,
  useSendMessage,
  useUploadAttachment,
  useCalicolorsId,
  useConversations,
} from '@/lib/hooks/useChat';
import { useChatRealtime } from '@/lib/hooks/useChatRealtime';
import {
  fetchPublicProfilesForChat,
  resolveOtherIdFromConvId,
} from './conversationHelpers';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';
import { is3WayConvId, type Message } from '@/lib/services/chat';
import { getSupabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';

export interface ChatConversationProps {
  convId: string;
}

export function ChatConversation({ convId }: ChatConversationProps) {
  const { user, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const is3way = is3WayConvId(convId);
  const [addingStore, setAddingStore] = useState(false);

  // Detecta se eu sou pintor (profissional) — só pintor pode adicionar
  // a loja Cali Colors no chat com o cliente (vanilla #invite-store-bar).
  const role = profile?.role || profile?.user_type;
  const isPainter =
    role === 'pintor' || role === 'grafiteiro' || role === 'automotivo';

  // Realtime: idempotente — se ChatList já montou, isso é no-op até unmount.
  // Cobre o caso de deeplink direto na conv.
  useChatRealtime(user?.id ?? null);

  // Wave 24: marca todas as msgs recebidas dessa conversa como lidas quando
  // o user abre. Invalida o counter da TopNav. RPC é idempotente — chamar
  // 2x não duplica trabalho.
  useEffect(() => {
    if (!user?.id || !convId) return;
    let cancelled = false;
    (async () => {
      try {
        const { markConversationRead } = await import('@/lib/services/chat-messages');
        await markConversationRead(convId);
        if (!cancelled) {
          qc.invalidateQueries({ queryKey: ['messages-unread-count', user.id] });
        }
      } catch {
        // Silent — badge fica stale uns segundos, sem-op pro fluxo principal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, convId, qc]);

  // ID da loja Cali Colors (pra colorir msgs dela como 'store').
  const { id: storeId } = useCalicolorsId();

  // Resolve o "outro lado" do chat pra usar como receiver_id no INSERT.
  // - 1:1: strip do convId, pega o UUID != myId.
  // - 3-way: o painterId vem do convId (após strip do prefix), e o receiver
  //   canônico continua sendo o pintor (a loja recebe via realtime broadcast).
  const otherId = useMemo(
    () => (user ? resolveOtherIdFromConvId(convId, user.id) : null),
    [convId, user],
  );

  // Conversation meta (pro header — nome, avatar, role). Lê do cache de
  // useConversations; se não tiver, mostra placeholder "Carregando...".
  const { conversations } = useConversations();
  const convMeta = useMemo(
    () => conversations.find((c) => c.convId === convId),
    [conversations, convId],
  );

  // Fallback do header pra conversa NOVA (sem histórico → não está no cache de
  // useConversations → convMeta undefined). Sem isso o header ficava preso em
  // "Carregando…" e o avatar em "?" (BUG33). Busca o peer direto.
  const { data: peerProfile } = useQuery<
    { name: string | null; avatar_url: string | null; tag: string | null } | null,
    Error
  >({
    queryKey: ['chat-peer', otherId],
    queryFn: async () => {
      const sb = getSupabase();
      const { data } = await sb
        .from('profiles_public')
        .select('name, avatar_url, tag')
        .eq('id', otherId as string)
        .maybeSingle();
      return (data as { name: string | null; avatar_url: string | null; tag: string | null } | null) ?? null;
    },
    enabled: !convMeta && !!otherId && !is3way,
    staleTime: 5 * 60_000,
  });
  // Nome/avatar/tag resolvidos: convMeta (cache da lista) tem prioridade;
  // senão usa o peer buscado direto.
  const peerName = convMeta?.name ?? peerProfile?.name ?? peerProfile?.tag ?? null;
  const peerAvatar = convMeta?.avatarUrl ?? peerProfile?.avatar_url ?? null;
  const peerTag = convMeta?.tag ?? peerProfile?.tag ?? null;

  // Mensagens da conversa.
  const { messages, loading, error } = useMessages(convId);

  // Send + Upload.
  const sendHook = useSendMessage(convId, otherId);
  const uploadHook = useUploadAttachment();

  // Map sender_id → nome+avatar pra MessageList pintar bolha "other" certo.
  // Pra otherId já temos via convMeta; pra outros (3-way: loja + outros
  // membros que entrem) carregamos sob demanda usando os senderIds das msgs.
  const [participantInfo, setParticipantInfo] = useState<
    Map<string, { name: string | null; avatar: string | null }>
  >(new Map());

  useEffect(() => {
    let cancelled = false;
    const missingIds = new Set<string>();
    for (const m of messages) {
      if (m.senderId && m.senderId !== user?.id && !participantInfo.has(m.senderId)) {
        missingIds.add(m.senderId);
      }
    }
    if (missingIds.size === 0) return;
    fetchPublicProfilesForChat(Array.from(missingIds)).then((profs) => {
      if (cancelled) return;
      setParticipantInfo((prev) => {
        const next = new Map(prev);
        for (const p of profs) {
          next.set(p.id, { name: p.name ?? null, avatar: p.avatarUrl ?? null });
        }
        // Bonus: hidrata Cali Colors caso apareça nas msgs.
        if (storeId && !next.has(storeId)) {
          next.set(storeId, { name: 'Cali Colors', avatar: null });
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [messages, user, storeId, participantInfo]);

  // Pré-hidrata convMeta como participantInfo[otherId].
  useEffect(() => {
    if (!convMeta || !convMeta.otherId) return;
    // Pré-narrowing fora do setState pra TS não perder a refinement no
    // callback. Substitui os non-null assertions (otherId!) que existiam.
    const otherId = convMeta.otherId;
    setParticipantInfo((prev) => {
      if (prev.has(otherId)) return prev;
      const next = new Map(prev);
      next.set(otherId, {
        name: convMeta.name,
        avatar: convMeta.avatarUrl,
      });
      return next;
    });
  }, [convMeta]);

  // Handler de retry — remove a temp* failed do cache e re-envia.
  function handleRetry(msg: Message): void {
    if (msg.status !== 'failed') return;
    qc.setQueryData<Message[]>(['chat', 'messages', convId], (curr) =>
      (curr ?? []).filter((m) => m.id !== msg.id),
    );
    if (msg.type === 'text') {
      sendHook.send({ text: msg.content });
    }
    // attachment retry: caller perdeu o File obj, então não dá pra re-uploadar.
    // O usuário precisa selecionar de novo. Documentado em comportamento NÃO
    // portado no report final.
  }

  async function handleSendAttachment(file: File): Promise<void> {
    const uploaded = await uploadHook.upload(file);
    if (!uploaded) return;
    sendHook.send({ text: '', attachment: uploaded });
  }

  // Add-store: replica `addStoreToChat()` vanilla (modules/chat.js linha 927).
  // Insere marker __STORE_ADDED__ (type=system) + welcome (type=store) na
  // conv. O realtime detecta o system marker e atualiza is3way na sidebar.
  async function handleAddStore() {
    if (!user || !otherId || is3way || addingStore) return;
    setAddingStore(true);
    try {
      const sb = getSupabase();
      const storeText =
        'Olá! 👋 Fui convidado para ajudar nesta conversa. Como posso auxiliar com tintas e materiais?';
      // 1) marker system (faz a conv virar 3-way no agrupador da sidebar)
      await sb.from('messages').insert({
        sender_id: user.id,
        receiver_id: otherId,
        conversation_id: convId,
        content: '__STORE_ADDED__',
        type: 'system',
      });
      // 2) welcome message do Cali Colors (type=store pra pintar bolha laranja)
      await sb.from('messages').insert({
        sender_id: user.id,
        receiver_id: otherId,
        conversation_id: convId,
        content: storeText,
        type: 'store',
      });
      // Invalida tudo pra UI virar 3-way + welcome aparecer
      qc.invalidateQueries({ queryKey: ['chat', 'messages', convId] });
      qc.invalidateQueries({ queryKey: ['chat', 'conversations', user.id] });
      showToast('Cali Colors foi adicionada ao chat! 🎨', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao adicionar Cali Colors', 'error');
    } finally {
      setAddingStore(false);
    }
  }

  // Banner aparece quando: viewer é pintor + conv não é 3-way + outro lado
  // existe (não é a própria loja). Vanilla também checa que não é convId
  // pra/da própria loja — convMeta.isStore cobre isso.
  const showAddStoreBanner =
    isPainter &&
    !is3way &&
    !!convMeta &&
    !convMeta.isStore &&
    !!otherId;

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-sm text-[color:var(--color-muted,#666)]">
        Carregando...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="text-5xl" aria-hidden="true">
          💬
        </div>
        <p className="text-sm text-[color:var(--color-muted,#666)]">
          Faça login pra ver e enviar mensagens.
        </p>
        <Link
          href="/login"
          className="px-5 py-2 bg-[color:var(--color-p1,#ff6a00)] text-white rounded-xl font-semibold text-sm"
        >
          Entrar
        </Link>
      </div>
    );
  }

  // Usa peerName (convMeta OU peer buscado direto). Só fica "Carregando…" se
  // nem o otherId resolveu ainda (auth carregando) — não mais preso em conv nova.
  const headerName = is3way
    ? (peerName || 'Conversa') + ' + Cali Colors'
    : peerName || (otherId ? 'Conversa' : 'Carregando...');

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center gap-3 p-3 border-b border-[color:var(--color-border,#e5e5e5)] bg-white">
        <Link
          href="/chat"
          className="px-2 py-1 text-lg"
          aria-label="Voltar para lista de conversas"
        >
          &larr;
        </Link>
        {is3way ? (
          // Avatares empilhados pro chat 3-way (pintor + Cali Colors).
          // Vanilla chat.js linha 947+: CC (loja) à esquerda, outro user à
          // direita, com overlap de ~10px.
          <div
            className="relative flex-shrink-0"
            style={{ width: 52, height: 40 }}
            aria-hidden="true"
          >
            <span
              className="absolute flex items-center justify-center"
              style={{
                left: 0,
                top: 0,
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--color-ink)',
                border: '2px solid #fff',
                zIndex: 2,
                color: 'var(--color-p1)',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              CC
            </span>
            <span
              className="absolute overflow-hidden bg-[color:var(--color-border)] flex items-center justify-center text-xs font-bold"
              style={{
                left: 20,
                top: 0,
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: '2px solid #fff',
                zIndex: 1,
              }}
            >
              {convMeta?.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={convMeta.avatarUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                (convMeta?.name ?? '?').charAt(0).toUpperCase()
              )}
            </span>
          </div>
        ) : (
          <span
            className="w-10 h-10 rounded-full overflow-hidden bg-[color:var(--color-border,#e5e5e5)] flex items-center justify-center text-sm font-bold flex-shrink-0"
            aria-hidden="true"
          >
            {peerAvatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={peerAvatar}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              (peerName ?? '?').charAt(0).toUpperCase()
            )}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{headerName}</div>
          <div className="text-xs text-[color:var(--color-muted,#666)] truncate">
            {is3way
              ? '3 participantes · Chat 3-way ativo'
              : peerTag
                ? '@' + peerTag
                : ''}
          </div>
        </div>
      </header>

      {/* Banner pra adicionar Cali Colors (3-way) — só pra pintor em
          conversa 1:1 que ainda não tem a loja. Vanilla #invite-store-bar. */}
      {showAddStoreBanner ? (
        <div
          className="flex items-center gap-3 px-4 py-2.5 border-b"
          style={{
            background: 'linear-gradient(90deg, rgba(255,107,53,.08), rgba(131,56,236,.08))',
            borderColor: 'var(--color-border)',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 20 }}>🔗</span>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-ink)' }}>
              Adicione a Cali Colors ao chat
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              Loja oficial ajuda com tintas e materiais
            </div>
          </div>
          <button
            type="button"
            onClick={handleAddStore}
            disabled={addingStore}
            className="text-white font-bold"
            style={{
              padding: '7px 12px',
              borderRadius: 999,
              background: 'var(--color-p1)',
              fontSize: 11,
              border: 'none',
              cursor: addingStore ? 'wait' : 'pointer',
              opacity: addingStore ? 0.6 : 1,
            }}
          >
            {addingStore ? '...' : '+ Adicionar'}
          </button>
        </div>
      ) : null}

      {/* Lista de mensagens */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center p-8 text-sm text-[color:var(--color-muted,#666)]">
          Carregando mensagens...
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-8 text-sm text-red-600">
          Erro ao carregar: {error.message}
        </div>
      ) : (
        <MessageList
          messages={messages}
          myId={user.id}
          storeId={storeId}
          participantInfo={participantInfo}
          onRetry={handleRetry}
        />
      )}

      {/* Composer */}
      <MessageComposer
        sending={sendHook.sending}
        disabled={!otherId}
        errorMessage={
          sendHook.error?.message ??
          uploadHook.error?.message ??
          (!otherId ? 'Destinatário não resolvido — abra a conversa novamente.' : null)
        }
        onSendText={(t) => sendHook.send({ text: t })}
        onSendAttachment={handleSendAttachment}
      />
    </div>
  );
}
