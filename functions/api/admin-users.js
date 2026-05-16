// Promove/revoga acesso ao portal de um perfil.
// O portal usa a anon key e a unica policy de UPDATE em profiles e
// auth.uid() = id, entao um admin nao consegue alterar o profile de
// outra pessoa pelo cliente (a alteracao falha silenciosamente).
// Este endpoint usa a service role (ignora RLS) e so autoriza quem
// ja tem portal_access = true.
//
// Requer no Cloudflare Pages: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY.
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Gestao de usuarios nao configurada (SUPABASE_SERVICE_ROLE_KEY ausente)' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON invalido' }, 400); }

  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
  const action = typeof body?.action === 'string' ? body.action : '';
  const userId = typeof body?.userId === 'string' ? body.userId : '';

  if (!accessToken) return json({ error: 'sem token' }, 401);
  if (!userId) return json({ error: 'userId obrigatorio' }, 400);
  if (action !== 'promote' && action !== 'revoke') return json({ error: 'acao invalida' }, 400);

  const supaUrl = (env.SUPABASE_URL || 'https://uwqebaqweehiljsqkifm.supabase.co').replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const sHeaders = {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  // Valida o token e descobre quem esta chamando
  let callerId = '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey }
    });
    if (!u.ok) return json({ error: 'token invalido' }, 401);
    const ud = await u.json();
    callerId = ud?.id || '';
  } catch (e) {
    return json({ error: 'falha ao validar token' }, 401);
  }
  if (!callerId) return json({ error: 'token invalido' }, 401);

  // So quem ja tem portal_access pode promover/revogar
  try {
    const g = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=portal_access`, { headers: sHeaders });
    const arr = await g.json();
    if (!arr?.[0]?.portal_access) return json({ error: 'nao autorizado' }, 403);
  } catch (e) {
    return json({ error: 'falha ao verificar permissao' }, 502);
  }

  const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify({ portal_access: action === 'promote' })
  });
  if (!r.ok) return json({ error: `supabase ${r.status}: ${(await r.text()).slice(0, 150)}` }, 502);
  const updated = await r.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    return json({ error: 'perfil nao encontrado' }, 404);
  }
  return json({ ok: true, portal_access: action === 'promote' });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
