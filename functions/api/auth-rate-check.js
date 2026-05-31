// @ts-check
// Controller fino — rate limit defensivo de auth por IP. Cliente chama ANTES
// de bater na auth do Supabase pra economizar request e dificultar brute force.
// É camada ADVISORY: defesa real é rate limit nativo do Supabase + Cloudflare
// Rate Limiting Rules no edge (no BACKLOG).
import { jsonResponse as json, checkRateLimit, rateLimitResponse } from './_security.js';

const LIMITS = { login: 10, signup: 5, reset: 5 };

/**
 * @param {{ request: Request, env: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  let body = {}; try { body = await request.json(); } catch { /* sem body é OK */ }
  const actionRaw = typeof body?.action === 'string' ? body.action : 'login';
  const action = (LIMITS[actionRaw] !== undefined) ? actionRaw : 'login';
  const limit = LIMITS[action];
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rl = await checkRateLimit(env, 'ip:' + ip + ':' + action, 'auth-' + action, limit);
  if (!rl.allowed) return rateLimitResponse(rl);
  // skipped=true → SUPABASE_SERVICE_ROLE não configurada → fail-open
  return json({ allowed: true, action, limit, skipped: !!rl.skipped }, 200);
}

/**
 * @returns {Promise<Response>}
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
