// @ts-check
// Recebe relatórios de erro do front + Web Vitals. Loga no console (Cloudflare)
// E persiste na tabela `errors` (Supabase) pra dashboard caseiro substituir
// Sentry. Fail-open: se SUPABASE_SERVICE_ROLE não estiver configurada ou a
// tabela ainda não existir, segue só com o console.log.
import { checkRateLimit, rateLimitResponse, jsonResponse as json, FALLBACK_SUPABASE_URL } from './_security.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string>, waitUntil?: (p: Promise<any>) => void }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  let body = {};
  try { body = await request.json(); } catch { return json({ ok: true }, 200); }

  // Rate limit por IP — 60 erros/min por IP
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rl = await checkRateLimit(env, 'ip:' + ip, 'log-error', 60);
  if (!rl.allowed) return rateLimitResponse(rl);

  // Trunca campos pra evitar abuse (max ~2KB no total)
  const trunc = (s, n) => typeof s === 'string' ? s.slice(0, n) : s;
  const safe = {
    type: trunc(body.type, 32),                 // 'error' | 'unhandledrejection' | 'web-vital' | 'manual' | 'pageview'
    msg: trunc(body.msg, 500),
    stack: trunc(body.stack, 1500),
    url: trunc(body.url, 300),
    ua: trunc(body.ua, 200),
    metric: trunc(body.metric, 32),             // pra web-vital: LCP|CLS|INP|FCP|TTFB
    value: typeof body.value === 'number' ? body.value : undefined,
    ctx: trunc(body.ctx, 100),                  // contexto opcional
    ts: Date.now()
  };

  // Cloudflare logs aceitam até ~256KB; isso aqui é tipo 2KB no max
  console.log('[client-log]', JSON.stringify(safe));

  // ── Persistência em tabela `errors` (substituto caseiro de Sentry). ──
  // Fire-and-forget via context.waitUntil: não bloqueia a resposta. Se a
  // service-role não estiver configurada ou a tabela ainda não existir,
  // é skip silencioso (só o console.log de cima continua).
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    // user_id vem do body (cliente envia quando logado). Valida como UUID
    // antes de gravar — não confiamos cegamente em string arbitrária.
    const uidStr = typeof body.user_id === 'string' ? body.user_id : '';
    const user_id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uidStr) ? uidStr : null;
    const row = {
      type: safe.type || null,
      msg: safe.msg || null,
      stack: safe.stack || null,
      url: safe.url || null,
      ua: safe.ua || null,
      metric: safe.metric || null,
      value: typeof safe.value === 'number' ? safe.value : null,
      ctx: safe.ctx || null,
      user_id,
      client_ts: typeof safe.ts === 'number' ? safe.ts : null
    };
    const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
    const insert = fetch(supaUrl + '/rest/v1/errors', {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000)
    }).then(r => {
      if (!r.ok) console.warn('[log-error] insert failed:', r.status);
    }).catch(e => console.warn('[log-error] insert err:', e && e.message));
    if (typeof context.waitUntil === 'function') context.waitUntil(insert);
  }

  return json({ ok: true }, 200);
}

// CORS preflight
/**
 * @returns {Promise<Response>}
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
