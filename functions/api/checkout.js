// @ts-check
// Controller fino — Mercado Pago preapproval (assinatura PRO).
// Business logic em `./_services/checkout.js`.
import { jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { createProCheckout } from './_services/checkout.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  try {
    return json(await createProCheckout({ env, accessToken }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('checkout crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}
