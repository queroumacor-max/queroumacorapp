// @ts-check
// Business logic — recebe payload de erro do front, sanitiza, e (quando
// SUPABASE_SERVICE_ROLE configurado) persiste em `errors` via REST.
// Controller cuida de rate-limit e do envelope HTTP.
import { FALLBACK_SUPABASE_URL } from '../_security.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSERT_TIMEOUT_MS = 5000;

/**
 * Sanitiza o body do request pra um payload safe-to-log.
 * @param {Record<string, any>} body
 * @returns {{ type: string, msg: string, stack: string, url: string, ua: string, metric: string, value: number|undefined, ctx: string, ts: number, user_id: string|null }}
 */
export function sanitizeErrorPayload(body) {
  const trunc = (s, n) => typeof s === 'string' ? s.slice(0, n) : s;
  const uidStr = typeof body.user_id === 'string' ? body.user_id : '';
  return {
    type: trunc(body.type, 32),
    msg: trunc(body.msg, 500),
    stack: trunc(body.stack, 1500),
    url: trunc(body.url, 300),
    ua: trunc(body.ua, 200),
    metric: trunc(body.metric, 32),
    value: typeof body.value === 'number' ? body.value : undefined,
    ctx: trunc(body.ctx, 100),
    ts: Date.now(),
    user_id: UUID_RE.test(uidStr) ? uidStr : null
  };
}

/**
 * Persiste o erro na tabela `errors` (best-effort, swallow erros).
 * @param {{ env: Record<string,string>, safe: ReturnType<typeof sanitizeErrorPayload> }} args
 * @returns {Promise<void>}
 */
export async function insertErrorRow({ env, safe }) {
  const serviceKey = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  const row = {
    type: safe.type || null,
    msg: safe.msg || null,
    stack: safe.stack || null,
    url: safe.url || null,
    ua: safe.ua || null,
    metric: safe.metric || null,
    value: typeof safe.value === 'number' ? safe.value : null,
    ctx: safe.ctx || null,
    user_id: safe.user_id,
    client_ts: typeof safe.ts === 'number' ? safe.ts : null
  };
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  try {
    const r = await fetch(supaUrl + '/rest/v1/errors', {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(INSERT_TIMEOUT_MS)
    });
    if (!r.ok) console.warn('[log-error] insert failed:', r.status);
  } catch (e) {
    console.warn('[log-error] insert err:', e && e.message);
  }
}
