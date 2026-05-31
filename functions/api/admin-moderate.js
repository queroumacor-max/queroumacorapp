// @ts-check
// Controller fino — fila de moderação admin. Business logic em `./_services/admin-moderate.js`.
import { jsonResponse as json, checkRateLimit, rateLimitResponse, serviceErrorResponse, ServiceError } from './_security.js';
import { verifyAdminToken, ensureAdminEmail, isAdminEmail, getServiceKey } from './_services/_admin.js';
import { approvePost, rejectPost } from './_services/admin-moderate.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!getServiceKey(env) || !env.ADMIN_EMAILS) {
    return json({ error: 'Moderação admin não configurada' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const action = typeof body?.action === 'string' ? body.action : '';
  const postId = typeof body?.postId === 'string' ? body.postId : '';
  try {
    const { callerId, email } = await verifyAdminToken({ env, accessToken: body?.accessToken || '' });
    if (action === 'check') return json({ admin: isAdminEmail(env, email) });
    ensureAdminEmail(env, email);
    const rl = await checkRateLimit(env, callerId || email, 'admin-moderate', 60);
    if (!rl.allowed) return rateLimitResponse(rl);
    if (action === 'approve') return json(await approvePost({ env, postId }));
    if (action === 'reject')  return json(await rejectPost({ env, postId }));
    return json({ error: 'ação inválida' }, 400);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-moderate crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
