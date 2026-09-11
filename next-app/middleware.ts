// middleware.ts — duas responsabilidades, as duas por request:
//
//   1. `x-request-id` (Backend#24): correlaciona logs/erros/Sentry entre
//      frontend (gerador) ↔ backend (logger) ↔ Supabase (consumidor). Se a
//      request já vem com o header (cliente ou proxy upstream), preserva;
//      senão gera UUID. O route handler vê o id em
//      `request.headers.get('x-request-id')` e o cliente recebe no response.
//
//   2. Content-Security-Policy com NONCE (pentest Strix, 2026-09-11). Antes
//      a CSP vivia no `headers()` do next.config com `'unsafe-inline'` em
//      `script-src` — o que deixa qualquer `<script>` injetado rodar. Agora
//      cada request ganha um nonce; a política vive em `lib/csp.ts`. Dois
//      detalhes que não são opcionais:
//        - a CSP vai nos headers da REQUEST também: é de lá
//          (`content-security-policy`) que o Next lê o nonce pra carimbar nos
//          scripts dele (hidratação, chunks). Só `x-nonce` não basta.
//        - `x-nonce` fica disponível pra qualquer server component que
//          precise de um inline por request (`(await headers()).get('x-nonce')`).
//          O layout raiz NÃO o usa: `headers()` lá tornaria a `/_not-found`
//          dinâmica, e essa rota não roda no edge — os inline do layout
//          entram por HASH (ver lib/csp.ts).
//      Nonce só vale em HTML renderizado por request, então o layout raiz
//      declara `runtime = 'edge'` (desliga a geração estática das páginas).
//      `/portal` (HTML estático) recebe a CSP por hash e `/pdf/*` responde
//      com CSP própria — ver `cspParaPath`.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cspParaPath, gerarNonce } from '@/lib/csp';

export function middleware(request: NextRequest) {
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && incoming.trim() ? incoming.trim() : crypto.randomUUID();

  const nonce = gerarNonce();
  // `request.url` em vez de `nextUrl`: funciona com Request cru (testes) também.
  const csp = cspParaPath(new URL(request.url).pathname, nonce);

  // Clona headers do request. NextResponse.next com `request.headers`
  // reescreve os headers vistos pelo route handler / layout.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  if (csp) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('x-request-id', requestId);
  if (csp) response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Tudo que pode ser DOCUMENTO passa aqui (páginas, /api, /portal, /pdf).
  // Fora: os chunks e imagens otimizadas do Next — asset puro, sem HTML, e
  // são a maior parte das requests.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
