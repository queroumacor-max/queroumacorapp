// chat-messages.ts — fetch + envio de mensagens.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import {
  rowToMessage,
  type Message,
  type MessageType,
  type RawMessageRow,
} from './chat-types';

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
  const { data, error } = await sb
    .from('messages')
    .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
    .eq('conversation_id', convId)
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
