// @ts-check
// Controller fino — LGPD Art. 18 V (portabilidade dos dados).
// Business logic em `./_services/me-export.js`.
import { getToken, jsonResponse as json, checkRateLimit, rateLimitResponse, serviceErrorResponse, ServiceError } from './_security.js';
import { authenticateForExport, exportUserData } from './_services/me-export.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  let body = {}; try { body = await request.json(); } catch { /* sem body OK */ }
  try {
    const { userId, email } = await authenticateForExport({ env, accessToken: getToken(request, body) });
    // Rate limit (3/min): export bate em 16 queries paralelas — sem isso, DoS fácil.
    const rl = await checkRateLimit(env, userId, 'me-export', 3);
    if (!rl.allowed) return rateLimitResponse(rl);
    const data = await exportUserData({ env, userId, email });
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="queroumacor-meus-dados-${userId.slice(0, 8)}.json"`,
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('me-export crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
