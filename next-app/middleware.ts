// middleware.ts — propaga `x-request-id` em todas as rotas /api/*.
// Backend#24 (hardening pós-auditoria): correlaciona logs/erros/Sentry
// entre frontend (gerador) ↔ backend (logger) ↔ Supabase (consumidor).
//
// Comportamento:
//   - Se a request já vem com `x-request-id` (cliente gerou ou veio de
//     um proxy upstream), preserva.
//   - Senão, gera UUID novo via `crypto.randomUUID()` (disponível em
//     edge runtime + node runtime).
//   - Reescreve os headers do request para que o route handler veja o id
//     em `request.headers.get('x-request-id')`, e ecoa no response pra
//     que o cliente possa logar/exibir.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && incoming.trim() ? incoming.trim() : crypto.randomUUID();

  // Clona headers do request e seta x-request-id. NextResponse.next com
  // `request.headers` reescreve os headers vistos pelo route handler.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  // Só rotas API — evita custo em assets estáticos e SSR.
  matcher: ['/api/:path*'],
};
