// @ts-check
// Controller fino — diag de modelos IA (admin/PRO).
// GET /api/ig-art-diag        → lista modelos da chave Gemini
// GET /api/ig-art-diag?openai=1 → testa também OpenAI gpt-image-1
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { diagnoseIgArt } from './_services/ig-art-diag.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet({ env, request }) {
  const g = await gateProAI(env, request, {}, { endpoint: 'ig-art-diag', limit: 10 });
  if (g instanceof Response) return g;
  try {
    const testOpenAI = new URL(request.url).searchParams.get('openai') === '1';
    return json(await diagnoseIgArt({ env, testOpenAI }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('ig-art-diag crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
