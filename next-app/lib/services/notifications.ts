// notifications.ts — service layer para a tabela `notifications` (sininho).
// Espelha o subset de comportamento de modules/notif.js (loadNotifications +
// markAsRead implícito + setupNotifSubscription) num shape testável sem DOM.
//
// Schema (supabase_init.sql linha 1008+):
//   id uuid, user_id uuid, actor_id uuid, type text, title text, body text,
//   ref_id text, read boolean DEFAULT false, created_at timestamptz
//
// A coluna de leitura é boolean (`read`), não timestamp (`read_at`). O spec
// original deste port mencionava `read_at`, mas seguimos o schema real pra
// evitar erro de coluna inexistente em runtime. Quando precisar mostrar
// "quando foi lido", podemos depois adicionar coluna read_at sem mudar a API.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';
import type { Notification } from '@/lib/types';

// Mesmas colunas que o vanilla puxa em modules/notif.js (linha 73).
const NOTIF_COLS = 'id, user_id, actor_id, type, title, body, ref_id, read, created_at';

// Limit alinhado com vanilla (loadNotifications puxa 20 da tabela + agrega
// outras fontes); aqui só temos `notifications`, então um pouco maior pra
// dar profundidade de histórico sem virar uma página gigante.
const DEFAULT_LIMIT = 50;

export interface FetchNotificationsOptions {
  // Cursor ISO timestamp (created_at da última row da página anterior).
  // null/undefined = primeira página (devolve as N mais recentes).
  cursor?: string | null;
  limit?: number;
  // signal pra cancelar fetches em voo (TanStack `useQuery({signal})`).
  signal?: AbortSignal;
}

export interface NotificationsPage {
  items: Notification[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Busca as notificações do usuário em ordem reverse-chronological.
 *
 * Sobrecarga retro-compat: caller que passar só userId recebe `Notification[]`
 * (comportamento antigo). Caller que passar `options` recebe `NotificationsPage`
 * com cursor pra infinite scroll. Keyset pagination (.lt('created_at', cursor))
 * evita shift quando novas notifs chegam entre páginas.
 *
 * Não trata o caso "sem client" devolvendo []; preferimos estourar — o caller
 * (useNotifications) só monta a query quando `user` já existe, e neste ponto
 * env vars têm que estar setadas. Se não estiverem, é bug de deploy.
 */
export async function fetchNotifications(userId: string): Promise<Notification[]>;
export async function fetchNotifications(
  userId: string,
  options: FetchNotificationsOptions,
): Promise<NotificationsPage>;
export async function fetchNotifications(
  userId: string,
  options?: FetchNotificationsOptions,
): Promise<Notification[] | NotificationsPage> {
  if (!userId) {
    return options ? { items: [], nextCursor: null, hasMore: false } : [];
  }
  const limit = Math.max(1, options?.limit ?? DEFAULT_LIMIT);
  const cursor = options?.cursor ?? null;
  const signal = options?.signal;
  const sb = getSupabase();
  let q = sb
    .from('notifications')
    .select(NOTIF_COLS)
    .eq('user_id', userId);
  if (cursor) {
    q = q.lt('created_at', cursor);
  }
  q = q.order('created_at', { ascending: false }).limit(limit);
  // `.abortSignal` tem tipagem tardia em alguns builds; cast via unknown
  // preserva runtime (suportado desde supabase-js >= 2.0).
  const qFinal = signal
    ? (q as unknown as { abortSignal: (s: AbortSignal) => typeof q }).abortSignal(signal)
    : q;
  const { data, error } = await qFinal;
  if (error) {
    throw new NetworkError(error.message, error);
  }
  const items = (data ?? []) as Notification[];
  if (!options) return items;
  const last = items[items.length - 1];
  const nextCursor = last?.created_at ?? null;
  const hasMore = items.length >= limit;
  return { items, nextCursor, hasMore };
}

/**
 * Marca uma notificação específica como lida. RLS em `notifications` só
 * permite UPDATE se `auth.uid() = user_id`, então não precisamos passar
 * userId aqui — o Postgres rejeita silenciosamente cross-user.
 */
export async function markAsRead(notifId: string): Promise<void> {
  if (!notifId) return;
  const sb = getSupabase();
  const { error } = await sb
    .from('notifications')
    .update({ read: true })
    .eq('id', notifId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Marca todas as não-lidas do usuário como lidas. Filtro `.eq('read', false)`
 * em vez de `.is('read', null)` porque o default da coluna é `false`, então
 * só linhas com `read=true` ficam fora — economiza UPDATE em linhas que já
 * estavam lidas.
 */
export async function markAllAsRead(userId: string): Promise<void> {
  if (!userId) return;
  const sb = getSupabase();
  const { error } = await sb
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}
