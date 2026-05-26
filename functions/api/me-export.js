// LGPD Art. 18 V — Direito de portabilidade.
// Devolve TODOS os dados pessoais do usuário logado em formato JSON.
// O usuário pode salvar e levar pra outro fornecedor.
//
// Requer JWT do usuário no body.accessToken ou Authorization header.
import { getToken, jsonResponse as json, FALLBACK_SUPABASE_URL, FALLBACK_ANON_KEY } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;

  let body = {};
  try { body = await request.json(); } catch { /* permite chamada sem body */ }

  const accessToken = getToken(request, body);
  if (!accessToken) return json({ error: 'login obrigatório' }, 401);

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

  // Valida token + pega userId
  let userId = '';
  let email = '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': 'Bearer ' + accessToken, 'apikey': anonKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!u.ok) return json({ error: 'sessão inválida' }, 401);
    const ud = await u.json();
    userId = ud?.id || '';
    email = ud?.email || '';
  } catch (e) {
    return json({ error: 'erro ao validar sessão' }, 502);
  }
  if (!userId) return json({ error: 'sessão inválida' }, 401);

  // Service role pra ler tudo do usuário sem RLS
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return json({ error: 'Exportação temporariamente indisponível' }, 503);
  }

  const sHeaders = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey };
  const get = async (table, query) => {
    try {
      const r = await fetch(`${supaUrl}/rest/v1/${table}?${query}`, {
        headers: sHeaders,
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  };

  // Busca todos os dados pessoais
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
    referrals_referrer
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

  const exportData = {
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

  // Devolve como download (filename + json)
  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="queroumacor-meus-dados-${userId.slice(0, 8)}.json"`,
      'cache-control': 'no-store'
    }
  });
}
