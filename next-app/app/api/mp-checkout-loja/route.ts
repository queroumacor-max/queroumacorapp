// app/api/mp-checkout-loja/route.ts — port de `functions/api/mp-checkout-loja.js`.
// Controller fino — Mercado Pago Checkout Pro (Loja).
// Business logic em `@/lib/api/_services/mp-checkout-loja`.

import { type NextRequest } from 'next/server';
import {
  ServiceError,
  jsonResponse,
  serviceErrorResponse,
} from '@/lib/api/security';
import { errorResponse } from '@/lib/api/errors';
import { createLojaCheckout } from '@/lib/api/_services/mp-checkout-loja';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  let body: { orderId?: unknown; accessToken?: unknown } = {};
  try {
    body = (await request.json()) as {
      orderId?: unknown;
      accessToken?: unknown;
    };
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const orderId =
    typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const accessToken =
    typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  try {
    return jsonResponse(await createLojaCheckout({ orderId, accessToken }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    // R-H11: exception vai pro Sentry com tag, cliente recebe msg genérica.
    return errorResponse(e, {
      status: 500,
      clientMessage: 'Erro interno — tente de novo em instantes',
      tags: { route: 'mp-checkout-loja' },
    });
  }
}
