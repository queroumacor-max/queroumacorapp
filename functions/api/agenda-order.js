// @ts-check
// Controller fino — otimiza ordem de visitas do dia. Lógica em `./_services/agenda-order.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { orderAgenda } from './_services/agenda-order.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'agenda-order', limit: 5 });
  if (g instanceof Response) return g;
  try {
    return json(await orderAgenda({ env, date: body?.date, jobs: body?.jobs }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('agenda-order crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
