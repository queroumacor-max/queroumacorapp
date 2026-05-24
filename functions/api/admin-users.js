// Promove/revoga acesso ao portal de um perfil.
// O portal usa a anon key e a unica policy de UPDATE em profiles e
// auth.uid() = id, entao um admin nao consegue alterar o profile de
// outra pessoa pelo cliente (a alteracao falha silenciosamente).
// Este endpoint usa a service role (ignora RLS) e so autoriza quem
// ja tem portal_access = true.
//
// Requer no Cloudflare Pages: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY.
import { jsonResponse as json, FALLBACK_SUPABASE_URL } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  // Aceita 3 nomes de service key pra compatibilidade
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return json({ error: 'Gestao de usuarios nao configurada (SUPABASE_SERVICE_ROLE/SUPABASE_SERVICE_KEY ausente)' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON invalido' }, 400); }

  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
  const action = typeof body?.action === 'string' ? body.action : '';
  const userId = typeof body?.userId === 'string' ? body.userId : '';

  const ROLE_MAP = {
    pintor: { role: 'pintor', user_type: 'pintor', profession: 'pintor' },
    grafiteiro: { role: 'grafiteiro', user_type: 'grafiteiro', profession: 'grafiteiro' },
    automotivo: { role: 'automotivo', user_type: 'automotivo', profession: 'automotivo' },
    funileiro: { role: 'automotivo', user_type: 'automotivo', profession: 'funileiro' },
    cliente: { role: 'cliente', user_type: 'cliente' },
  };

  if (!accessToken) return json({ error: 'sem token' }, 401);
  if (!userId) return json({ error: 'userId obrigatorio' }, 400);

  let patch;
  if (action === 'promote' || action === 'revoke') {
    patch = { portal_access: action === 'promote' };
  } else if (action === 'verify') {
    patch = { verified: body?.value === true };
  } else if (action === 'set_pro') {
    const enable = body?.value === true;
    let expiresAt = null;
    if (enable) {
      const raw = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
      const parsed = raw ? new Date(raw) : null;
      expiresAt = (parsed && !isNaN(parsed.getTime()))
        ? parsed.toISOString()
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }
    patch = { is_pro: enable, pro_expires_at: expiresAt };
  } else if (action === 'set_role') {
    const m = ROLE_MAP[typeof body?.roleKey === 'string' ? body.roleKey : ''];
    if (!m) return json({ error: 'roleKey invalido' }, 400);
    patch = { ...m };
  } else {
    return json({ error: 'acao invalida' }, 400);
  }

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || serviceKey;
  const sHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  // Valida o token e descobre quem esta chamando (id + email)
  let callerId = '';
  let callerEmail = '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey }
    });
    if (!u.ok) return json({ error: 'token invalido' }, 401);
    const ud = await u.json();
    callerId = ud?.id || '';
    callerEmail = (ud?.email || '').toLowerCase();
  } catch (e) {
    return json({ error: 'falha ao validar token' }, 401);
  }
  if (!callerId) return json({ error: 'token invalido' }, 401);

  // Dupla checagem: portal_access ATIVO no profile E email na whitelist
  // ADMIN_EMAILS. Antes, qualquer lojista com portal_access podia se
  // autopromover a PRO eterno via {action:'set_pro'}. Agora as 2 condições
  // precisam bater pra evitar lojista escalando privilégios.
  const adminEmails = (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!callerEmail || !adminEmails.includes(callerEmail)) {
    return json({ error: 'nao autorizado (email nao admin)' }, 403);
  }
  try {
    const g = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=portal_access`, { headers: sHeaders });
    const arr = await g.json();
    if (!arr?.[0]?.portal_access) return json({ error: 'nao autorizado (portal_access)' }, 403);
  } catch (e) {
    return json({ error: 'falha ao verificar permissao' }, 502);
  }

  const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!r.ok) return json({ error: `supabase ${r.status}: ${(await r.text()).slice(0, 150)}` }, 502);
  const updated = await r.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    return json({ error: 'perfil nao encontrado' }, 404);
  }
  return json({ ok: true, patch });
}
