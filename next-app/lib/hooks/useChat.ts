// useChat.ts — hooks React pra feature chat (lista + mensagens + busca).
//
// Substitui o setup imperativo do vanilla (modules/chat.js: loadChatList +
// renderConvList + window.openChat + window.startNewChat) por um shape
// declarativo via TanStack Query.
//
// Hooks expostos:
//  - useConversations() → lista de conversas do user; invalidação vem do
//    useChatRealtime (não desse hook diretamente).
//  - useMessages(convId) → mensagens da conv ativa; otimistic updates
//    appendam direto no cache (queryClient.setQueryData), realtime também
//    appenda direto (useChatRealtime) em vez de invalidar — evita refetch
//    completo a cada msg nova.
//  - useSendMessage(convId) → mutation otimista (cria msg temp-* antes da
//    resposta; reconcilia com ID real no success ou marca failed em erro).
//  - useNewChat() → wrap pra findOrCreateConversation + warm-up do cache.
//  - useSearchUsers(query, excludeIds) → useQuery com debounce no caller.
//
// Decisões:
//  - Anti double-submit: o componente checa `mutation.isPending` antes de
//    chamar mutate. Como mutate é fire-and-forget, isPending vira true
//    sincronicamente após a chamada.
//  - Moderação: useSendMessage chama /api/moderate ANTES de inserir. Se o
//    backend bloquear, o erro vira `mutation.error.message`. NÃO faz a
//    chamada do banco se reject — sem cleanup de placeholder.
//  - Roteamento receiverId: pra 1:1 a outra ponta é trivial (strip do
//    convId). Pra 3-way, caller passa otherId explícito (componente sabe
//    se é o pintor ou a loja).

'use client';

import { useCallback } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchConversations,
  fetchMessages,
  sendMessage,
  uploadAttachment,
  searchUsers,
  findOrCreateConversation,
  findOrCreate3WayWithStore,
  markConversationAs3Way,
  resolveCalicolorsUserId,
  type ConversationMeta,
  type Message,
  type MessageType,
  type UserMini,
  type AttachmentUploadResult,
} from '@/lib/services/chat';

// ─── useConversations ───────────────────────────────────────────────────

export interface UseConversationsResult {
  conversations: ConversationMeta[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useConversations(): UseConversationsResult {
  const { user } = useAuth();
  const query = useQuery<ConversationMeta[], Error>({
    queryKey: ['chat', 'conversations', user?.id ?? null],
    queryFn: ({ signal }) => fetchConversations(user!.id, { signal }),
    enabled: !!user,
    staleTime: 15_000,
  });
  return {
    conversations: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    refetch: () => {
      query.refetch();
    },
  };
}

// ─── useMessages ────────────────────────────────────────────────────────

export interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMessages(convId: string | null): UseMessagesResult {
  const { user } = useAuth();
  const query = useQuery<Message[], Error>({
    queryKey: ['chat', 'messages', convId],
    queryFn: () => fetchMessages(convId!),
    // Só busca quando temos user + convId (evita 1ª roundtrip sem contexto).
    enabled: !!user && !!convId,
    // Não staleia auto — realtime atualiza o cache. Refetch só por refresh
    // manual / unmount-remount. Staletime alto evita refetch ao trocar
    // de aba e voltar.
    staleTime: 5 * 60_000,
  });
  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    refetch: () => {
      query.refetch();
    },
  };
}

// ─── useSendMessage ─────────────────────────────────────────────────────
// Mutação otimista. O caller passa o convId e o otherId (resolvido por
// rota dinâmica /chat/[convId]). Aqui só fazemos:
//   1. Append da msg temp-* no cache de mensagens (UI vê imediato);
//   2. POST /api/moderate (se reject → throw, mutation marca failed);
//   3. INSERT na tabela messages;
//   4. Replace da temp pela real (com ID novo) no cache;
//   5. Invalida `conversations` pra que last-msg atualize na sidebar.
// Em erro: marca a temp como status='failed' (UI mostra retry button).

interface SendMessageVars {
  text: string;
  attachment?: AttachmentUploadResult;
}

export interface UseSendMessageResult {
  send: (vars: SendMessageVars) => void;
  sending: boolean;
  error: Error | null;
  reset: () => void;
}

export function useSendMessage(
  convId: string | null,
  toId: string | null,
): UseSendMessageResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  const mutation = useMutation<Message, Error, SendMessageVars>({
    mutationFn: async ({ text, attachment }) => {
      if (!user) throw new Error('Faça login pra enviar mensagens');
      if (!convId) throw new Error('Conversa inválida');
      if (!toId) throw new Error('Destinatário não resolvido');

      // Decide tipo final + content.
      const finalContent = attachment ? attachment.url : text;
      const finalType: MessageType = attachment ? attachment.messageType : 'text';

      // Moderação — só pra texto (attachments têm validação MIME/size própria).
      // POST pro endpoint server-side; se 4xx/5xx ou flagged=true → throw.
      if (finalType === 'text') {
        const trimmed = (text || '').trim();
        if (!trimmed) throw new Error('Mensagem vazia');
        try {
          const res = await fetch('/api/moderate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: trimmed }),
          });
          // Endpoint pode estar 503 (sem GEMINI_API_KEY) — nesse caso
          // seguimos sem bloquear, igual o vanilla (moderateContentAsync
          // fallback graceful).
          if (res.ok) {
            const json = (await res.json()) as { flagged?: boolean; approved?: boolean };
            const blocked = json.flagged === true || json.approved === false;
            if (blocked) throw new Error('Mensagem bloqueada pela moderação');
          }
        } catch (e) {
          // Network/parse error do moderate — não bloqueia envio. Re-throw
          // só se foi o nosso "Mensagem bloqueada".
          if (e instanceof Error && e.message.includes('moderação')) throw e;
        }
      }

      return sendMessage(convId, user.id, toId, finalContent, finalType);
    },

    onMutate: async (vars) => {
      if (!user || !convId) return;
      const tempId = 'temp-' + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
      const finalContent = vars.attachment ? vars.attachment.url : vars.text.trim();
      const finalType: MessageType = vars.attachment ? vars.attachment.messageType : 'text';
      const tempMsg: Message = {
        id: tempId,
        conversationId: convId,
        senderId: user.id,
        receiverId: toId,
        content: finalContent,
        type: finalType,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      // Cancela queries pendentes pra não sobrescrever otimismo.
      await qc.cancelQueries({ queryKey: ['chat', 'messages', convId] });
      const prev = qc.getQueryData<Message[]>(['chat', 'messages', convId]) ?? [];
      qc.setQueryData<Message[]>(['chat', 'messages', convId], [...prev, tempMsg]);
      return { tempId, prev };
    },

    onSuccess: (real, _vars, ctx) => {
      if (!convId) return;
      const tempId = (ctx as { tempId?: string } | undefined)?.tempId;
      qc.setQueryData<Message[]>(['chat', 'messages', convId], (curr) => {
        if (!curr) return [real];
        // Substitui a temp pela real; se a temp já sumiu (realtime chegou
        // antes), apenda direto desde que não duplique.
        const withoutTemp = tempId ? curr.filter((m) => m.id !== tempId) : curr;
        if (withoutTemp.some((m) => m.id === real.id)) return withoutTemp;
        return [...withoutTemp, real];
      });
      // Atualiza last-msg da sidebar.
      qc.invalidateQueries({ queryKey: ['chat', 'conversations', user?.id ?? null] });
    },

    onError: (_err, _vars, ctx) => {
      if (!convId) return;
      const tempId = (ctx as { tempId?: string } | undefined)?.tempId;
      qc.setQueryData<Message[]>(['chat', 'messages', convId], (curr) => {
        if (!curr) return curr;
        return curr.map((m) =>
          m.id === tempId ? { ...m, status: 'failed' as const } : m,
        );
      });
    },
  });

  return {
    send: (vars) => {
      // Guard de double-submit: TanStack já bloqueia mutate duplicado de
      // forma cooperativa via isPending, mas explicitar deixa o intent claro.
      if (mutation.isPending) return;
      mutation.mutate(vars);
    },
    sending: mutation.isPending,
    error: mutation.error ?? null,
    reset: () => {
      mutation.reset();
    },
  };
}

// ─── useNewChat ─────────────────────────────────────────────────────────

export interface NewChatVars {
  otherId: string;
  is3WayWithStore?: boolean;
}

export interface UseNewChatResult {
  start: (vars: NewChatVars) => Promise<string | null>;
  creating: boolean;
  error: Error | null;
}

export function useNewChat(): UseNewChatResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  const mutation = useMutation<string, Error, NewChatVars>({
    mutationFn: async ({ otherId, is3WayWithStore }) => {
      if (!user) throw new Error('Faça login');
      if (is3WayWithStore) {
        return findOrCreate3WayWithStore(user.id, otherId);
      }
      return findOrCreateConversation(user.id, otherId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'conversations', user?.id ?? null] });
    },
  });

  const start = useCallback(
    async (vars: NewChatVars): Promise<string | null> => {
      try {
        return await mutation.mutateAsync(vars);
      } catch {
        return null;
      }
    },
    [mutation],
  );

  return {
    start,
    creating: mutation.isPending,
    error: mutation.error ?? null,
  };
}

// ─── useSearchUsers ─────────────────────────────────────────────────────
// Caller faz debounce do `query` antes de passar (ex.: useEffect + setTimeout
// 250ms). Aqui só ligamos no TanStack; staleTime 30s pra evitar refetch ao
// digitar e apagar e digitar de novo a mesma coisa em sequência rápida.

export interface UseSearchUsersResult {
  users: UserMini[];
  loading: boolean;
  error: Error | null;
}

export function useSearchUsers(
  query: string,
  excludeIds: string[] = [],
): UseSearchUsersResult {
  const result = useQuery<UserMini[], Error>({
    queryKey: ['chat', 'search-users', query, excludeIds.join(',')],
    queryFn: ({ signal }) => searchUsers(query, excludeIds, { signal }),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
  return {
    users: result.data ?? [],
    loading: result.isLoading && result.fetchStatus !== 'idle',
    error: result.error ?? null,
  };
}

// ─── useUploadAttachment ────────────────────────────────────────────────

export interface UseUploadAttachmentResult {
  upload: (file: File) => Promise<AttachmentUploadResult | null>;
  uploading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useUploadAttachment(): UseUploadAttachmentResult {
  const { user } = useAuth();
  const mutation = useMutation<AttachmentUploadResult, Error, File>({
    mutationFn: (file: File) => {
      if (!user) throw new Error('Faça login');
      return uploadAttachment(user.id, file);
    },
  });

  return {
    upload: async (file: File) => {
      try {
        return await mutation.mutateAsync(file);
      } catch {
        return null;
      }
    },
    uploading: mutation.isPending,
    error: mutation.error ?? null,
    reset: () => mutation.reset(),
  };
}

// ─── useMarkConversation3Way ────────────────────────────────────────────
// Helper exposto pra UI usar quando o usuário clica "Convidar Cali Colors".
// Insere o system marker __STORE_ADDED__ e invalida a sidebar.

export function useMarkConversation3Way(
  convId: string | null,
  toId: string | null,
) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!user) throw new Error('Faça login');
      if (!convId) throw new Error('Conversa inválida');
      if (!toId) throw new Error('Destinatário inválido');
      await markConversationAs3Way(convId, user.id, toId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'conversations', user?.id ?? null] });
      qc.invalidateQueries({ queryKey: ['chat', 'messages', convId] });
    },
  });
}

// ─── useCalicolorsId ────────────────────────────────────────────────────
// Resolve o user ID da loja (cache eterno — mudança requer redeploy).

export function useCalicolorsId(): { id: string | null; loading: boolean } {
  const q = useQuery<string | null, Error>({
    queryKey: ['chat', 'calicolors-id'],
    queryFn: () => resolveCalicolorsUserId(),
    staleTime: Infinity,
  });
  return { id: q.data ?? null, loading: q.isLoading };
}
