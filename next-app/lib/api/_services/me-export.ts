// lib/api/_services/me-export.ts — port de
// `functions/api/_services/me-export.js`. LGPD Art. 18 V (portabilidade).
// Recolhe TODOS os dados pessoais do usuário em paralelo e devolve um
// objeto JSON pronto pra serialização.
//
// Diferenças do vanilla:
//   - Sem FALLBACK_SUPABASE_URL — `getSupabaseUrl()` throws se ausente.
//   - `authenticateForExport` foi removido; controller usa `requireAuthStrict`
//     direto de `security.ts` (mesmo papel, sem duplicação).

import { ServiceError, getServiceKey, getSupabaseUrl } from '../security';

const QUERY_TIMEOUT_MS = 15000;

export interface ExportPayload {
  _meta: {
    exported_at: string;
    user_id: string;
    email: string;
    schema_version: string;
    lgpd_article: string;
    contact: string;
  };
  profile: Record<string, unknown> | null;
  quotes: unknown[];
  orders: unknown[];
  messages: { sent: unknown[]; received: unknown[] };
  notifications: unknown[];
  notes: unknown[];
  points: unknown[];
  reviews: unknown[];
  follows: { following: unknown[]; followers: unknown[] };
  likes: unknown[];
  comments: unknown[];
  posts: unknown[];
  referrals: { referred: unknown[]; referrer: unknown[] };
}

/**
 * Busca todos os dados pessoais do usuário (16 queries paralelas via service_role).
 * Cada query individual é tolerante a falha (retorna []) pra que um problema em
 * uma tabela não derrube o export inteiro — vanilla faz o mesmo.
 */
export async function exportUserData(args: {
  userId: string;
  email: string;
}): Promise<ExportPayload> {
  const { userId, email } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Exportação temporariamente indisponível', 503);
  const supaUrl = getSupabaseUrl();

  const sHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  const get = async (table: string, query: string): Promise<unknown[]> => {
    try {
      const r = await fetch(`${supaUrl}/rest/v1/${table}?${query}`, {
        headers: sHeaders,
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      if (!r.ok) return [];
      return (await r.json()) as unknown[];
    } catch {
      return [];
    }
  };

  const uid = encodeURIComponent(userId);
  const [
    profile,
    quotes,
    orders,
    messages_sent,
    messages_received,
    notifications,
    notes,
    points,
    reviews,
    follows_following,
    follows_followers,
    likes,
    comments,
    posts,
    referrals_referred,
    referrals_referrer,
  ] = await Promise.all([
    get('profiles', `id=eq.${uid}&select=*`),
    get('quotes', `or=(client_id.eq.${uid},painter_id.eq.${uid})&select=*`),
    get('orders', `user_id=eq.${uid}&select=*`),
    get('messages', `sender_id=eq.${uid}&select=*`),
    get('messages', `receiver_id=eq.${uid}&select=*`),
    get('notifications', `user_id=eq.${uid}&select=*`),
    get('notes', `user_id=eq.${uid}&select=*`),
    get('points', `user_id=eq.${uid}&select=*`),
    get('reviews', `reviewer_id=eq.${uid}&select=*`),
    get('follows', `follower_id=eq.${uid}&select=*`),
    get('follows', `following_id=eq.${uid}&select=*`),
    get('likes', `user_id=eq.${uid}&select=*`),
    get('comments', `user_id=eq.${uid}&select=*`),
    get('posts', `user_id=eq.${uid}&select=*`),
    get('referrals', `referred_id=eq.${uid}&select=*`),
    get('referrals', `referrer_id=eq.${uid}&select=*`),
  ]);

  return {
    _meta: {
      exported_at: new Date().toISOString(),
      user_id: userId,
      email,
      schema_version: '1.0',
      lgpd_article: 'Art. 18 V — Direito à portabilidade dos dados',
      contact: 'loja@calicolors.com.br',
    },
    profile: (profile[0] as Record<string, unknown> | undefined) || null,
    quotes,
    orders,
    messages: { sent: messages_sent, received: messages_received },
    notifications,
    notes,
    points,
    reviews,
    follows: { following: follows_following, followers: follows_followers },
    likes,
    comments,
    posts,
    referrals: { referred: referrals_referred, referrer: referrals_referrer },
  };
}
