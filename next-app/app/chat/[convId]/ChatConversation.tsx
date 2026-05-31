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
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
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

export interface ChatConversationProps {
  convId: string;
}

export function ChatConversation({ convId }: ChatConversationProps) {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const is3way = is3WayConvId(convId);

  // Realtime: idempotente — se ChatList já montou, isso é no-op até unmount.
  // Cobre o caso de deeplink direto na conv.
  useChatRealtime(user?.id ?? null);

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
    setParticipantInfo((prev) => {
      if (prev.has(convMeta.otherId!)) return prev;
      const next = new Map(prev);
      next.set(convMeta.otherId!, {
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

  const headerName = convMeta
    ? is3way
      ? (convMeta.name || 'Conversa') + ' + Cali Colors'
      : (convMeta.name || 'Conversa')
    : 'Carregando...';

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
        <span
          className="w-10 h-10 rounded-full overflow-hidden bg-[color:var(--color-border,#e5e5e5)] flex items-center justify-center text-sm font-bold flex-shrink-0"
          aria-hidden="true"
        >
          {convMeta?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={convMeta.avatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            (convMeta?.name ?? '?').charAt(0).toUpperCase()
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{headerName}</div>
          <div className="text-xs text-[color:var(--color-muted,#666)] truncate">
            {is3way
              ? '3 participantes · Chat 3-way ativo'
              : convMeta?.tag
                ? '@' + convMeta.tag
                : ''}
          </div>
        </div>
      </header>

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
