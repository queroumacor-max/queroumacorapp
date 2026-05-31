// @ts-check
// Controller fino — promove/revoga portal_access, set PRO, role, verified.
// Business logic em `./_services/admin-users.js`.
import { jsonResponse as json, checkRateLimit, rateLimitResponse, serviceErrorResponse, ServiceError } from './_security.js';
import { verifyAdminToken, isAdminEmail, getServiceKey } from './_services/_admin.js';
import { buildPatch, ensureCallerHasPortalAccess, patchProfile } from './_services/admin-users.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!getServiceKey(env)) {
    return json({ error: 'Gestão de usuários não configurada (SUPABASE_SERVICE_ROLE/SUPABASE_SERVICE_KEY ausente)' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ error: 'userId obrigatório' }, 400);
  try {
    const patch = buildPatch(body);
    const { callerId, email } = await verifyAdminToken({ env, accessToken: body?.accessToken || '' });
    if (!callerId) throw new ServiceError('token inválido', 401);
    if (!isAdminEmail(env, email)) throw new ServiceError('não autorizado (email não admin)', 403);
    await ensureCallerHasPortalAccess({ env, callerId });
    const rl = await checkRateLimit(env, callerId || email, 'admin-users', 30);
    if (!rl.allowed) return rateLimitResponse(rl);
    return json(await patchProfile({ env, userId, patch }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-users crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
