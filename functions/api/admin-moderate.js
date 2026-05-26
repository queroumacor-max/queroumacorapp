// Fila de moderação admin: verifica se o usuário é admin e aprova/rejeita posts.
// Requer no Cloudflare Pages: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY e ADMIN_EMAILS (lista separada por vírgula).
import { jsonResponse as json, FALLBACK_SUPABASE_URL, checkRateLimit, rateLimitResponse } from './_security.js';

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
  let callerId = '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!u.ok) return json({ admin: false, error: 'token inválido' }, 401);
    const ud = await u.json();
    email = (ud?.email || '').toLowerCase();
    callerId = ud?.id || '';
  } catch (e) {
    return json({ admin: false, error: 'falha ao validar token' }, 401);
  }

  const admins = env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = !!email && admins.includes(email);

  if (action === 'check') return json({ admin: isAdmin });
  if (!isAdmin) return json({ error: 'não autorizado' }, 403);
  if (!postId) return json({ error: 'postId obrigatório' }, 400);

  // Rate limit pra admin (60 req/min): defesa contra credenciais
  // comprometidas ou script de admin rodando em loop.
  const rl = await checkRateLimit(env, callerId || email, 'admin-moderate', 60);
  if (!rl.allowed) return rateLimitResponse(rl);

  const sHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  if (action === 'approve') {
    const r = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      headers: { ...sHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'approved' }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.warn('admin-moderate approve supabase error', r.status, txt);
      return json({ error: 'Falha temporária na consulta — tente de novo' }, 502);
    }
    return json({ ok: true });
  }

  if (action === 'reject') {
    // Pega a mídia para remover do storage também
    let mediaUrl = '';
    try {
      const g = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=media_url`, { headers: sHeaders, signal: AbortSignal.timeout(10000) });
      const arr = await g.json();
      mediaUrl = arr?.[0]?.media_url || '';
    } catch (e) { /* segue mesmo sem a mídia */ }

    const d = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      headers: { ...sHeaders, 'Prefer': 'return=minimal' },
      signal: AbortSignal.timeout(10000)
    });
    if (!d.ok) {
      const txt = (await d.text()).slice(0, 300);
      console.warn('admin-moderate reject supabase error', d.status, txt);
      return json({ error: 'Falha temporária na consulta — tente de novo' }, 502);
    }

    if (mediaUrl && mediaUrl.includes('/posts/')) {
      const rawPath = mediaUrl.split('/posts/').pop() || '';
      // Anti-traversal: bloqueia .. e URL-encoded ..
      const path = (/^[A-Za-z0-9_\-./]+$/.test(rawPath) && !rawPath.includes('..') && !rawPath.includes('%2E') && !rawPath.includes('%2e'))
        ? rawPath : null;
      if (path) {
        try {
          await fetch(`${supaUrl}/storage/v1/object/posts/${path}`, { method: 'DELETE', headers: sHeaders, signal: AbortSignal.timeout(10000) });
        } catch (e) { /* best-effort */ }
      }
    }
    return json({ ok: true });
  }

  return json({ error: 'ação inválida' }, 400);
}
