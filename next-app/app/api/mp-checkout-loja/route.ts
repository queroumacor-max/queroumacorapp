// app/api/mp-checkout-loja/route.ts — port de `functions/api/mp-checkout-loja.js`.
// Controller fino — Mercado Pago Checkout Pro (Loja).
// Business logic em `@/lib/api/_services/mp-checkout-loja`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  ServiceError,
  jsonResponse,
  serviceErrorResponse,
} from '@/lib/api/security';
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
    console.error('mp-checkout-loja crash:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Erro interno — tente de novo em instantes' },
      { status: 500 }
    );
  }
}
