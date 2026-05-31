// @ts-check
// Dashboard caseiro de erros (substitui Sentry). Lê da tabela `errors` via
// service_role e devolve pra UI admin. Autenticação: ADMIN_EMAILS (mesmo
// padrão do admin-moderate.js). Sem ele, qualquer usuário poderia ler logs
// alheios — RLS da tabela não basta porque o endpoint usa service_role.
import { jsonResponse as json, FALLBACK_SUPABASE_URL, checkRateLimit, rateLimitResponse, getToken } from './_security.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !env.ADMIN_EMAILS) {
    return json({ error: 'Dashboard admin não configurado (faltam env vars)' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Aceita token via Authorization header OU body.accessToken — apiPost
  // do client injeta no header; outros callers passam no body.
  const accessToken = getToken(request, body);
  if (!accessToken) return json({ admin: false, error: 'sem token' }, 401);

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || serviceKey;

  // Verifica usuário e email
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
  } catch {
    return json({ admin: false, error: 'falha ao validar token' }, 401);
  }

  const admins = env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!email || !admins.includes(email)) return json({ error: 'não autorizado' }, 403);

  // Rate limit defensivo (60 reqs/min por admin — dashboard refresh humano fica bem abaixo)
  const rl = await checkRateLimit(env, callerId || email, 'admin-errors-list', 60);
  if (!rl.allowed) return rateLimitResponse(rl);

  // ── Filtros aceitos no body (todos opcionais) ──
  const limit = Math.min(Math.max(parseInt(body?.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(body?.offset) || 0, 0);
  const filterType = typeof body?.type === 'string' && body.type ? body.type.slice(0, 32) : '';
  const sinceHours = Math.min(Math.max(parseInt(body?.since_hours) || 24, 1), 720); // 1h a 30d
  const search = typeof body?.search === 'string' && body.search ? body.search.slice(0, 100) : '';

  const sinceISO = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

  // Monta query PostgREST. select=id,created_at,... + filtros via params.
  const qs = new URLSearchParams();
  qs.set('select', 'id,created_at,type,msg,stack,url,ua,metric,value,ctx,user_id,client_ts');
  qs.set('order', 'created_at.desc');
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));
  qs.set('created_at', `gte.${sinceISO}`);
  if (filterType) qs.set('type', `eq.${filterType}`);
  if (search) qs.set('msg', `ilike.*${search}*`);

  try {
    const r = await fetch(`${supaUrl}/rest/v1/errors?${qs.toString()}`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'count=exact'  // devolve Content-Range com total
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.warn('admin-errors-list supabase error', r.status, txt);
      return json({ error: 'Falha ao consultar logs' }, 502);
    }
    const rows = await r.json();
    // Content-Range vem como "0-49/1234" — extrai o total.
    const range = r.headers.get('content-range') || '';
    const total = range.includes('/') ? parseInt(range.split('/')[1]) || rows.length : rows.length;
    return json({ rows, total, limit, offset, since_hours: sinceHours });
  } catch (e) {
    console.warn('admin-errors-list exception:', e && e.message);
    return json({ error: 'Erro de rede consultando logs' }, 502);
  }
}

/**
 * @returns {Promise<Response>}
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
