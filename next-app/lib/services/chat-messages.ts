// chat-messages.ts — fetch + envio + soft delete de mensagens.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import {
  rowToMessage,
  type Message,
  type MessageType,
  type RawMessageRow,
} from './chat-types';
import type { SoftDeleteResult } from './postInteractions';

// Limite default de mensagens carregadas por conversa. Vanilla usava 100
// (saveMsgLocal trimava em 100); aqui 50 é o ponto de partida — paginação
// pra histórico maior fica como follow-up.
const DEFAULT_MESSAGES_LIMIT = 50;

// Cap defensivo pra limite passado pelo caller (protege contra paginação
// abusiva que estouraria 10MB de response do Supabase).
const MESSAGES_LIMIT_MAX = 500;

/**
 * Busca o histórico de mensagens de uma conversa (mais antigas primeiro,
 * estilo IG/WhatsApp). Filtra mensagens system (markers internos como
 * __STORE_ADDED__) pra UI não pintar bolha vazia.
 */
export async function fetchMessages(
  convId: string,
  limit: number = DEFAULT_MESSAGES_LIMIT,
): Promise<Message[]> {
  if (!convId) return [];
  const sb = getSupabase();
  const safeLimit = Math.min(Math.max(1, limit), MESSAGES_LIMIT_MAX);
  // Defesa em profundidade — a RLS já esconde soft-deleted, mas filtramos
  // no cliente também pra não depender de policy atualizada em outros
  // contextos (ex.: portal admin que pode ver tudo, mas a UI normal não
  // quer mostrar bolha "deletada").
  const { data, error } = await sb
    .from('messages')
    .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
    .eq('conversation_id', convId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new NetworkError(error.message, error);
  const rows = (data ?? []) as RawMessageRow[];
  // Inverte pra ordem cronológica (asc) e filtra system markers.
  return rows
    .filter((m) => m.type !== 'system')
    .reverse()
    .map(rowToMessage);
}

/**
 * Insere uma mensagem. NÃO chama /api/moderate aqui — moderação é do caller
 * (hook useSendMessage chama antes do mutate). Service só faz I/O puro.
 *
 * receiverId é obrigatório no banco (NOT NULL). Pro 3-way com loja, o caller
 * pode passar o ID da loja ou o ID do pintor (ambos válidos). Em chat 1:1
 * é sempre o outro participante.
 */
export async function sendMessage(
  convId: string,
  fromId: string,
  toId: string,
  content: string,
  type: MessageType = 'text',
): Promise<Message> {
  if (!convId) throw new ValidationError('convId obrigatório');
  if (!fromId) throw new ValidationError('fromId obrigatório');
  if (!toId) throw new ValidationError('toId obrigatório');
  const trimmed = (content ?? '').trim();
  if (!trimmed && type === 'text') throw new ValidationError('Mensagem vazia');

  const sb = getSupabase();
  const { data, error } = await sb
    .from('messages')
    .insert({
      sender_id: fromId,
      receiver_id: toId,
      conversation_id: convId,
      content: type === 'text' ? trimmed : content,
      type,
    })
    .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
    .single();
  if (error) throw new NetworkError(error.message, error);
  if (!data) throw new NetworkError('Mensagem não retornada');
  return rowToMessage(data as RawMessageRow);
}

/**
 * Insere o marker __STORE_ADDED__ que sinaliza promoção de 1:1 → 3-way.
 * fetchConversations (no fallback) reconhece esse marker pra marcar is3way.
 */
export async function markConversationAs3Way(
  convId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  await sendMessage(convId, fromId, toId, '__STORE_ADDED__', 'system');
}

// ─── SOFT DELETE + UNDO ────────────────────────────────────────────────────

/**
 * Soft delete de mensagem: marca `deleted_at = now()` em vez de remover. A
 * RLS atualizada esconde mensagens com deleted_at IS NOT NULL de SELECTs
 * normais (admin ainda vê via policy de portal_access).
 *
 * Filtramos eq('sender_id') no UPDATE — só o remetente pode soft-deletar a
 * mensagem própria (receiver não tem permissão pelo RLS atual).
 */
export async function softDeleteMessage(
  messageId: string,
  userId: string,
): Promise<SoftDeleteResult> {
  if (!messageId) throw new ValidationError('messageId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('sender_id', userId);
  if (error) throw new NetworkError(error.message, error);
  return { undoToken: messageId };
}

/**
 * Reverte soft delete de mensagem. Idempotente — chamar 2x não estoura
 * erro. RLS já filtra pra sender_id = auth.uid().
 */
export async function undoDeleteMessage(
  messageId: string,
  userId: string,
): Promise<void> {
  if (!messageId) throw new ValidationError('messageId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('messages')
    .update({ deleted_at: null })
    .eq('id', messageId)
    .eq('sender_id', userId);
  if (error) throw new NetworkError(error.message, error);
}

/**
 * Marca todas as mensagens da conversa cujo receiver é o user logado como
 * lidas (read_at = now()). Idempotente — só toca rows com read_at IS NULL.
 * Backed por RPC mark_conversation_read (SECURITY DEFINER + auth.uid()).
 */
export async function markConversationRead(convId: string): Promise<number> {
  if (!convId) return 0;
  const sb = getSupabase();
  const rpc = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: number | null; error: { message: string } | null }>;
  const { data, error } = await rpc('mark_conversation_read', { p_conv_id: convId });
  if (error) throw new NetworkError(error.message, error);
  return data ?? 0;
}

/**
 * Contagem total de mensagens não lidas recebidas pelo user logado, em
 * todas as conversas. Usado pelo badge do ícone de chat na TopNav.
 * Backed por RPC unread_message_count (SECURITY DEFINER + auth.uid()).
 */
export async function fetchUnreadMessageCount(): Promise<number> {
  const sb = getSupabase();
  const rpc = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: number | null; error: { message: string } | null }>;
  const { data, error } = await rpc('unread_message_count', {});
  if (error) throw new NetworkError(error.message, error);
  return data ?? 0;
}
