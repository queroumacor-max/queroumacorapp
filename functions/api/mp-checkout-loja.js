// @ts-check
// Controller fino — Mercado Pago Checkout Pro (Loja).
// Business logic em `./_services/mp-checkout-loja.js`.
import { jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { createLojaCheckout } from './_services/mp-checkout-loja.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  try {
    const out = await createLojaCheckout({ env, orderId, accessToken });
    return json(out);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.error('mp-checkout-loja crash:', e && e.message);
    return json({ error: 'Erro interno — tente de novo em instantes' }, 500);
  }
}
