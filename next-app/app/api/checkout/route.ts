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
import { checkoutSchema, formatZodError } from '@/lib/api/schemas/checkout';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(formatZodError(parsed.error.issues), 400);
  }
  const accessToken = parsed.data.accessToken?.trim() ?? '';
  try {
    return jsonResponse(await createProCheckout({ accessToken }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('checkout crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
