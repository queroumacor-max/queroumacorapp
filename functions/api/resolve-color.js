// @ts-check
// Controller fino — resolve hex de cor de produtos de tinta.
// Business logic em `./_services/resolve-color.js`.
// POST { items: [{ id, name, code }] }  ->  { colors: { id: "#rrggbb" | null } }
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { resolveColors } from './_services/resolve-color.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'resolve-color', limit: 30 });
  if (g instanceof Response) return g;
  try {
    return json(await resolveColors({ env, items: body?.items }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('resolve-color crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
