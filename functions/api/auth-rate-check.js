// @ts-check
// Rate limit defensivo de auth (login/signup/reset) por IP.
// Cliente chama ANTES de bater na auth do Supabase. Se 429, aborta sem
// nem tentar — economiza request no Supabase Auth e dificulta brute force.
//
// É uma camada ADVISORY: cliente honesto respeita; atacante pula. A defesa
// real é (a) o rate limit nativo do Supabase Auth + (b) Cloudflare Rate
// Limiting Rules no edge (no BACKLOG). Esta camada filtra o tráfego comum.
import { jsonResponse as json, checkRateLimit, rateLimitResponse } from './_security.js';

/**
 * @param {{ request: Request, env: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  let body = {};
  try { body = await request.json(); } catch { /* sem body é OK — usa default */ }

  // action permitidas: 'login' | 'signup' | 'reset'. Default 'login'.
  const allowed = { login: 10, signup: 5, reset: 5 };
  const actionRaw = typeof body?.action === 'string' ? body.action : 'login';
  const action = (allowed[actionRaw] !== undefined) ? actionRaw : 'login';
  const limit = allowed[action];

  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')
    || 'unknown';

  // Chave única por (IP, ação) — login + signup têm cotas independentes.
  // checkRateLimit usa a tabela rate_limits via RPC check_rate_limit.
  const rl = await checkRateLimit(env, 'ip:' + ip + ':' + action, 'auth-' + action, limit);
  if (!rl.allowed) return rateLimitResponse(rl);

  // skipped=true significa SUPABASE_SERVICE_ROLE não configurada — fail-open.
  // Cliente segue com a tentativa de auth normalmente.
  return json({ allowed: true, action, limit, skipped: !!rl.skipped }, 200);
}

/**
 * @returns {Promise<Response>}
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
