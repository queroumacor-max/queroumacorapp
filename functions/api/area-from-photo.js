// @ts-check
// Controller fino — estimativa de metragem por foto. Business logic em `./_services/area-from-photo.js`.
import { gateProAIForm, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { estimateAreaFromPhoto } from './_services/area-from-photo.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY) return json({ error: 'IA de visão não configurada: defina OPENAI_API_KEY' }, 503);
  let formData; try { formData = await request.formData(); } catch { return json({ error: 'FormData inválido' }, 400); }
  const g = await gateProAIForm(env, request, formData, { endpoint: 'area-from-photo', limit: 5 });
  if (g instanceof Response) return g;
  try {
    return json(await estimateAreaFromPhoto({ env, image: formData.get('image') }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('area-from-photo crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
