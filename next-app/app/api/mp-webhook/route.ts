// app/api/mp-webhook/route.ts — port de `functions/api/mp-webhook.js`.
// Webhook do Mercado Pago. Critical path — leia comentários em
// `@/lib/api/_services/mp-webhook` antes de tocar.
//
// Controller deve:
//   - Ler raw body (string) — HMAC valida sobre rawBody, não sobre JSON
//     re-serializado.
//   - Repassar headers (com x-signature + x-request-id) pro service.
//   - SEMPRE retornar 200 nos erros não-fatais (evita retry storm do MP);
//     401 só pra signature inválida. O service já cuida disso — controller
//     só repassa { status, body }.

import { type NextRequest, NextResponse } from 'next/server';
import { processMpWebhook } from '@/lib/api/_services/mp-webhook';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    /* corpo vazio é tolerado (MP às vezes manda só querystring) */
  }
  try {
    const { status, body } = await processMpWebhook({
      rawBody,
      url: request.url,
      headers: request.headers,
    });
    return NextResponse.json(body, {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    // Defensive: service NÃO deve lançar (anti-retry storm). Se lançar,
    // ainda retornamos 200 pra MP não martelar.
    console.error('mp-webhook crash inesperado:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { received: true, msg: 'internal error swallowed' },
      { status: 200 }
    );
  }
}

// Mercado Pago também faz GET de validação no endpoint
export async function GET() {
  return NextResponse.json(
    { received: true, msg: 'mp-webhook ativo' },
    { status: 200 }
  );
}
