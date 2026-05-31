// @ts-check
// Controller fino — legenda + hashtags pra post de portfólio. Business logic em `./_services/caption.js`.
import { gateProAIForm, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { generateCaption } from './_services/caption.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY no Cloudflare Pages' }, 503);
  }
  let form; try { form = await request.formData(); } catch { return json({ error: 'multipart/form-data inválido' }, 400); }
  const g = await gateProAIForm(env, request, form, { endpoint: 'caption', limit: 10 });
  if (g instanceof Response) return g;
  try {
    return json(await generateCaption({ env, image: form.get('image') }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('caption crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
