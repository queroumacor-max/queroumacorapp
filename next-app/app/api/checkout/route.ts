// app/api/checkout/route.ts — port de `functions/api/checkout.js`.
// Controller fino — Mercado Pago preapproval (assinatura PRO).
// Business logic em `@/lib/api/_services/checkout`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  ServiceError,
  jsonResponse,
  serviceErrorResponse,
} from '@/lib/api/security';
import { createProCheckout } from '@/lib/api/_services/checkout';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  let body: { accessToken?: unknown } = {};
  try {
    body = (await request.json()) as { accessToken?: unknown };
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const accessToken =
    typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  try {
    return jsonResponse(await createProCheckout({ accessToken }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('checkout crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
