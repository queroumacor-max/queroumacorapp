// @ts-check
// Controller fino — dashboard caseiro de erros (substituto do Sentry).
// Business logic em `./_services/admin-errors-list.js`.
import { jsonResponse as json, checkRateLimit, rateLimitResponse, getToken, serviceErrorResponse, ServiceError } from './_security.js';
import { verifyAdminToken, ensureAdminEmail, getServiceKey } from './_services/_admin.js';
import { listErrors } from './_services/admin-errors-list.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!getServiceKey(env) || !env.ADMIN_EMAILS) {
    return json({ error: 'Dashboard admin não configurado (faltam env vars)' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  try {
    const { callerId, email } = await verifyAdminToken({ env, accessToken: getToken(request, body) });
    ensureAdminEmail(env, email);
    const rl = await checkRateLimit(env, callerId || email, 'admin-errors-list', 60);
    if (!rl.allowed) return rateLimitResponse(rl);
    return json(await listErrors({ env, filters: body || {} }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-errors-list crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}

/**
 * @returns {Promise<Response>}
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
