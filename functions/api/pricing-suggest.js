// @ts-check
// Controller fino — sugestão de preço de pintura. Business logic em `./_services/pricing-suggest.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { suggestPricing } from './_services/pricing-suggest.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY no Cloudflare Pages' }, 502);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'pricing-suggest', limit: 15 });
  if (g instanceof Response) return g;
  try {
    return json(await suggestPricing({ env, service_type: body?.service_type, description: body?.description, area_m2: body?.area_m2 }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('pricing-suggest crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
