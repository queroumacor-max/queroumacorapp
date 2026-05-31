// @ts-check
// Controller fino — auth/rate-limit + race contra hard-timeout (CF Pages mata
// a função aos 30s). Toda a lógica do gerador de arte vive em
// `./_services/ig-art.js`.
import { gateProAI, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { generateIgArt } from './_services/ig-art.js';

const OUTER_HARD_TIMEOUT_MS = 28000;  // < 30s do CF Pages, garante retorno JSON

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const hardTimeout = new Promise(resolve => setTimeout(() => resolve(json({
    error: 'Tempo esgotado',
    detail: 'Gerador de arte demorou mais que o limite. Tente novamente — pode ter sido pico de uso do provedor.'
  }, 504)), OUTER_HARD_TIMEOUT_MS));
  try {
    return await Promise.race([handle(context), hardTimeout]);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.error('ig-art handler-crash:', e && e.message);
    return json({ error: 'Erro interno', detail: String(e?.message || e).slice(0, 200) }, 500);
  }
}

async function handle({ env, request }) {
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const g = await gateProAI(env, request, body, { endpoint: 'ig-art', limit: 5 });
  if (g instanceof Response) return g;
  const result = await generateIgArt({ env, request, ...body });
  return json(result);
}
