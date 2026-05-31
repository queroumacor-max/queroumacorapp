// @ts-check
// Controller fino — rascunho de reativação CRM. Business logic em `./_services/crm-draft.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { draftReactivationMessage } from './_services/crm-draft.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY no Cloudflare Pages' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'crm-draft', limit: 10 });
  if (g instanceof Response) return g;
  try {
    return json(await draftReactivationMessage({ env, ...body }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('crm-draft crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
