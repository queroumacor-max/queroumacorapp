// @ts-check
// Controller fino — chat com o Seu Zé. Business logic em `./_services/chat-ai.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { chatWithSeuZe } from './_services/chat-ai.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY no Cloudflare Pages' }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'chat-ai', limit: 20 });
  if (g instanceof Response) return g;
  try {
    return json(await chatWithSeuZe({ env, message: body?.message, history: body?.history }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('chat-ai crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
