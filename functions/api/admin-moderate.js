// Fila de moderação admin: verifica se o usuário é admin e aprova/rejeita posts.
// Requer no Cloudflare Pages: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY e ADMIN_EMAILS (lista separada por vírgula).
import { jsonResponse as json, FALLBACK_SUPABASE_URL } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  // Aceita 3 nomes de service key pra compatibilidade
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !env.ADMIN_EMAILS) {
    return json({ error: 'Moderação admin não configurada' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
  const action = typeof body?.action === 'string' ? body.action : '';
  const postId = typeof body?.postId === 'string' ? body.postId : '';

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || serviceKey;

  // ── Verifica o usuário pelo token e checa se é admin ──
  if (!accessToken) return json({ admin: false, error: 'sem token' }, 401);
  let email = '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey }
    });
    if (!u.ok) return json({ admin: false, error: 'token inválido' }, 401);
    const ud = await u.json();
    email = (ud?.email || '').toLowerCase();
  } catch (e) {
    return json({ admin: false, error: 'falha ao validar token' }, 401);
  }

  const admins = env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = !!email && admins.includes(email);

  if (action === 'check') return json({ admin: isAdmin });
  if (!isAdmin) return json({ error: 'não autorizado' }, 403);
  if (!postId) return json({ error: 'postId obrigatório' }, 400);

  const sHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  if (action === 'approve') {
    const r = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: { ...sHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'approved' })
    });
    if (!r.ok) return json({ error: `supabase ${r.status}: ${(await r.text()).slice(0, 150)}` }, 502);
    return json({ ok: true });
  }

  if (action === 'reject') {
    // Pega a mídia para remover do storage também
    let mediaUrl = '';
    try {
      const g = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=media_url`, { headers: sHeaders });
      const arr = await g.json();
      mediaUrl = arr?.[0]?.media_url || '';
    } catch (e) { /* segue mesmo sem a mídia */ }

    const d = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      headers: { ...sHeaders, 'Prefer': 'return=minimal' }
    });
    if (!d.ok) return json({ error: `supabase ${d.status}: ${(await d.text()).slice(0, 150)}` }, 502);

    if (mediaUrl && mediaUrl.includes('/posts/')) {
      const path = mediaUrl.split('/posts/').pop();
      try {
        await fetch(`${supaUrl}/storage/v1/object/posts/${path}`, { method: 'DELETE', headers: sHeaders });
      } catch (e) { /* best-effort */ }
    }
    return json({ ok: true });
  }

  return json({ error: 'ação inválida' }, 400);
}
