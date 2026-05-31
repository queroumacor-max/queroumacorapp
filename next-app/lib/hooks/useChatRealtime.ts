// useChatRealtime — hook global que mantém uma única subscription Supabase
// Realtime pra todas as mensagens do usuário (sender_id ou receiver_id).
//
// Substitui setupGlobalMsgSubscription do vanilla (modules/chat.js linha 476).
// Responsabilidades:
//  - 1 channel por user (não por conversa) — evita N channels se o user
//    abre muitas conversas.
//  - Anti-duplicate via Map<msgId, true> com LRU cap 500 (idêntico ao
//    _processedMsgIds do vanilla).
//  - Invalida `conversations` em qualquer INSERT (last-msg muda).
//  - Appenda direto no cache de `messages` da conv ativa em vez de
//    invalidar — refetch completo a cada msg seria desperdício.
//
// Convenção: ChatList (ou app/chat/layout.tsx) chama useChatRealtime(user.id)
// uma única vez. Hook é idempotente (re-mount não duplica subscription
// porque useEffect cleanup remove o channel antes de remontar).

'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { Message, MessageType } from '@/lib/services/chat';

// LRU cap pra anti-duplicate. Mesmo valor do vanilla.
const MAX_PROCESSED_IDS = 500;

interface RawRealtimePayload {
  new: {
    id?: string;
    sender_id?: string;
    receiver_id?: string | null;
    conversation_id?: string;
    content?: string;
    type?: string | null;
    created_at?: string;
  };
}

export function useChatRealtime(userId: string | null): void {
  const qc = useQueryClient();
  // Map preserva ordem de inserção — usamos pra LRU eviction.
  const processedRef = useRef<Map<string, true>>(new Map());

  useEffect(() => {
    if (!userId) return;

    const sb = getSupabase();
    // markProcessed: true se a msg é nova, false se já vimos (dedup).
    function markProcessed(id: string): boolean {
      const map = processedRef.current;
      if (map.has(id)) {
        // refresh recency — move pro fim do Map.
        map.delete(id);
        map.set(id, true);
        return false;
      }
      map.set(id, true);
      if (map.size > MAX_PROCESSED_IDS) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      return true;
    }

    function handlePayload(payload: RawRealtimePayload): void {
      const raw = payload.new;
      if (!raw || !raw.id || !raw.conversation_id) return;
      if (!markProcessed(raw.id)) return;
      if (raw.type === 'system') {
        // System markers (__STORE_ADDED__) só atualizam a sidebar (is3way pode
        // ter virado true). Não vão pro cache de mensagens (filtramos lá).
        qc.invalidateQueries({ queryKey: ['chat', 'conversations', userId] });
        return;
      }
      const msg: Message = {
        id: raw.id,
        conversationId: raw.conversation_id,
        senderId: raw.sender_id ?? '',
        receiverId: raw.receiver_id ?? null,
        content: raw.content ?? '',
        type: ((raw.type as MessageType) ?? 'text'),
        createdAt: raw.created_at ?? new Date().toISOString(),
        status: 'sent',
      };

      // Append direto no cache da conv (se já existir). Dedup por id +
      // dedup por content+senderId+~time (cobre o caso em que o otimistic
      // send criou uma `temp-*` e a real chegou agora — não temos o ID
      // verdadeiro até a resposta do INSERT, então a temp ainda pode estar
      // lá quando o realtime entrega esse mesmo msg).
      qc.setQueryData<Message[]>(['chat', 'messages', msg.conversationId], (curr) => {
        if (!curr) return curr;
        // Dedup por id real.
        if (curr.some((m) => m.id === msg.id)) return curr;
        // Substitui temp-* equivalente (mesmo sender, mesmo content,
        // criada nos últimos 30s — janela generosa pra cobrir latência).
        const sameContentRecentTempIdx = curr.findIndex(
          (m) =>
            m.id.startsWith('temp-') &&
            m.senderId === msg.senderId &&
            m.content === msg.content &&
            Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 30_000,
        );
        if (sameContentRecentTempIdx >= 0) {
          const copy = curr.slice();
          copy[sameContentRecentTempIdx] = msg;
          return copy;
        }
        return [...curr, msg];
      });

      // Sidebar precisa atualizar last-msg + ordenação.
      qc.invalidateQueries({ queryKey: ['chat', 'conversations', userId] });
    }

    // 2 filtros (receiver/sender) pra cobrir ambos os lados (multi-device
    // sync também — quando o user envia do celular e tem a aba do desktop
    // aberta). Dedup via markProcessed garante que a mesma msg não duplica.
    const channel = sb
      .channel('chat-global-' + userId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${userId}`,
        },
        handlePayload,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=eq.${userId}`,
        },
        handlePayload,
      )
      .subscribe();

    return () => {
      // removeChannel desinscreve E remove da pool — unsubscribe sozinho
      // deixa o channel órfão (vazamento conhecido em supabase-js v2).
      sb.removeChannel(channel);
    };
  }, [userId, qc]);
}
