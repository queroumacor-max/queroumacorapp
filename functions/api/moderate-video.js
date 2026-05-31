// @ts-check
// Controller fino. Business logic em `./_services/moderate-video.js`.
import { checkRateLimit, rateLimitResponse, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { verifyOwnerToken, moderateVideoPost } from './_services/moderate-video.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  const serviceKey = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.GEMINI_API_KEY || !serviceKey) return json({ status: 'pending', error: 'moderação de vídeo não configurada' }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
  const postId = typeof body?.postId === 'string' ? body.postId : '';
  const caption = typeof body?.caption === 'string' ? body.caption.slice(0, 2000) : '';
  if (!postId) return json({ error: 'postId obrigatório' }, 400);
  try {
    const uid = await verifyOwnerToken({ env, accessToken });
    const rl = await checkRateLimit(env, uid, 'moderate-video', 3);
    if (!rl.allowed) return rateLimitResponse(rl);
    const out = await moderateVideoPost({ env, userId: uid, postId, caption });
    return json(out);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.error('moderate-video crash:', e && e.message);
    return json({ error: 'erro interno' }, 500);
  }
}
