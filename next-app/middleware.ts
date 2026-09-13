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

// Auditoria de segurança mobile (2026-09-13) — CVE-2025-66478 / CVE-2025-55182
// (CVSS 10.0, RCE): o pipeline de Server Actions do App Router desserializa o
// protocolo Flight de QUALQUER requisição que chegue com o header
// `Next-Action`, em toda versão 15.x/16.x afetada — independente de o app
// declarar alguma Server Action (`'use server'`). Este repo NÃO declara
// nenhuma (conferido: zero ocorrências de `'use server'` em app/lib/
// components), então esse header nunca é tráfego legítimo aqui.
//
// A versão instalada (`next@15.5.2`, corrigida só a partir da 15.5.7) está
// PRESA nesse valor: é o TETO EXATO do peer range do `@cloudflare/
// next-on-pages` (`>=14.3.0 && <=15.5.2` — o adapter que gera o deploy pro
// Cloudflare Pages). Subir o Next sem trocar de adapter quebra o build; e o
// próprio `@cloudflare/next-on-pages` já está descontinuado pelo mantenedor
// (recomenda migrar pro OpenNext), então não existe uma versão nova dele que
// destrave um Next mais novo — migrar de adapter é decisão arquitetural
// grande demais (e não testável sem um deploy real no Cloudflare) pra fazer
// dentro desta auditoria.
//
// Mitigação em profundidade que NÃO mexe em versão nem em config externa:
// barra a requisição ANTES do Next processar o corpo (404 — não confirma que
// a defesa existe). Zero custo funcional: nenhum código deste app manda esse
// header, porque nenhuma Server Action existe pra invocar.
function bloqueiaServerActionHeader(request: NextRequest): NextResponse | null {
  if (request.headers.has('next-action')) {
    return new NextResponse(null, { status: 404 });
  }
  return null;
}

export function middleware(request: NextRequest) {
  const bloqueado = bloqueiaServerActionHeader(request);
  if (bloqueado) return bloqueado;

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
  // O bloqueio de `Next-Action` (acima) precisa valer em QUALQUER rota do
  // App Router — Server Actions são invocadas via POST na própria URL da
  // página, não só em /api/*. Exclui assets estáticos (_next/static,
  // _next/image, o service worker e afins) por custo, não por segurança:
  // eles não passam pelo pipeline de Actions de qualquer forma.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.json).*)'],
};
