// @ts-check
// Controller fino — gera variações de logo. Business logic em `./_services/generate-logo.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { generateLogo } from './_services/generate-logo.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY não configurada no projeto Cloudflare Pages' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'generate-logo', limit: 3 });
  if (g instanceof Response) return g;
  try {
    return json(await generateLogo({ env, name: body?.name, style: body?.style }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('generate-logo crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
