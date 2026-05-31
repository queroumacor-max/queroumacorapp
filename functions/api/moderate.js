// @ts-check
// Controller fino — moderação de texto + imagem via Gemini.
// Business logic em `./_services/moderate.js`.
// Vídeo é tratado de forma assíncrona em /api/moderate-video.
import { requireAuth, checkRateLimit, rateLimitResponse, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { moderateContent } from './_services/moderate.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.GEMINI_API_KEY) {
    return json({ flagged: false, error: 'GEMINI_API_KEY não configurada', engine: 'none' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!auth.user) return json({ error: 'Faça login' }, 401);
  const rl = await checkRateLimit(env, auth.user.id, 'moderate', 20);
  if (!rl.allowed) return rateLimitResponse(rl);
  try {
    return json(await moderateContent({ env, text: body?.text, imageUrl: body?.imageUrl }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('moderate crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
