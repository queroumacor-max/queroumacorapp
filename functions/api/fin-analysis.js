// @ts-check
// Controller fino — análise financeira IA. Business logic em `./_services/fin-analysis.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { analyzeFinancials } from './_services/fin-analysis.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY no Cloudflare Pages' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'fin-analysis', limit: 5 });
  if (g instanceof Response) return g;
  try {
    return json(await analyzeFinancials({ env, thisMonth: body?.thisMonth, lastMonth: body?.lastMonth, recentJobs: body?.recentJobs }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('fin-analysis crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
