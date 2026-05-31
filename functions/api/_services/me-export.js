// @ts-check
// Business logic — LGPD Art. 18 V (portabilidade). Recolhe TODOS os dados
// pessoais do usuário em paralelo e devolve um objeto JSON.
import { ServiceError, FALLBACK_SUPABASE_URL, FALLBACK_ANON_KEY } from '../_security.js';

const AUTH_TIMEOUT_MS = 10000;
const QUERY_TIMEOUT_MS = 15000;

/**
 * Valida o JWT e devolve { userId, email }. Throw ServiceError em falha.
 * @param {{ env: Record<string,string>, accessToken: string }} args
 * @returns {Promise<{ userId: string, email: string }>}
 */
export async function authenticateForExport({ env, accessToken }) {
  if (!accessToken) throw new ServiceError('login obrigatório', 401);
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': 'Bearer ' + accessToken, 'apikey': anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
    });
    if (!u.ok) throw new ServiceError('sessão inválida', 401);
    const ud = await u.json();
    const userId = ud?.id || '';
    const email = ud?.email || '';
    if (!userId) throw new ServiceError('sessão inválida', 401);
    return { userId, email };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('erro ao validar sessão', 502);
  }
}

/**
 * Busca todos os dados pessoais do usuário (16 queries paralelas).
 * @param {{ env: Record<string,string>, userId: string, email: string }} args
 * @returns {Promise<Record<string, any>>}
 */
export async function exportUserData({ env, userId, email }) {
  const serviceKey = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new ServiceError('Exportação temporariamente indisponível', 503);

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const sHeaders = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey };
  const get = async (table, query) => {
    try {
      const r = await fetch(`${supaUrl}/rest/v1/${table}?${query}`, {
        headers: sHeaders,
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
      });
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  };
  const uid = encodeURIComponent(userId);
  const [
    profile, quotes, orders, messages_sent, messages_received, notifications, notes,
    points, reviews, follows_following, follows_followers, likes, comments, posts,
    referrals_referred, referrals_referrer
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
    get('referrals', `referrer_id=eq.${uid}&select=*`)
  ]);
  return {
    _meta: {
      exported_at: new Date().toISOString(),
      user_id: userId,
      email,
      schema_version: '1.0',
      lgpd_article: 'Art. 18 V — Direito à portabilidade dos dados',
      contact: 'loja@calicolors.com.br'
    },
    profile: profile[0] || null,
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
    referrals: { referred: referrals_referred, referrer: referrals_referrer }
  };
}
