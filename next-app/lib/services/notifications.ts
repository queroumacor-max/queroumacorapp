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

/**
 * Busca as últimas notificações do usuário em ordem reverse-chronological.
 * Não trata o caso "sem client" devolvendo []; preferimos estourar — o caller
 * (useNotifications) só monta a query quando `user` já existe, e neste ponto
 * env vars têm que estar setadas. Se não estiverem, é bug de deploy.
 */
export async function fetchNotifications(userId: string): Promise<Notification[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('notifications')
    .select(NOTIF_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(DEFAULT_LIMIT);
  if (error) {
    throw new NetworkError(error.message, error);
  }
  return (data ?? []) as Notification[];
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
