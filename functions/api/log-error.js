// @ts-check
// Controller fino — recebe relatório de erro do front + Web Vitals. Loga no
// console (Cloudflare) E persiste em `errors` via service. Fail-open: sem
// SUPABASE_SERVICE_ROLE/tabela ausente segue só com console.log.
import { checkRateLimit, rateLimitResponse, jsonResponse as json } from './_security.js';
import { sanitizeErrorPayload, insertErrorRow } from './_services/log-error.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string>, waitUntil?: (p: Promise<any>) => void }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  let body = {}; try { body = await request.json(); } catch { return json({ ok: true }, 200); }
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rl = await checkRateLimit(env, 'ip:' + ip, 'log-error', 60);
  if (!rl.allowed) return rateLimitResponse(rl);
  const safe = sanitizeErrorPayload(body);
  console.log('[client-log]', JSON.stringify(safe));
  const insert = insertErrorRow({ env, safe });
  if (typeof context.waitUntil === 'function') context.waitUntil(insert);
  return json({ ok: true }, 200);
}

/**
 * @returns {Promise<Response>}
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
