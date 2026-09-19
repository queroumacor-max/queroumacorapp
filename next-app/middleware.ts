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

// SEGURANÇA (2026-09-19) — headers de segurança migraram de `headers()` no
// next.config.mjs pra cá. Achado e provado nesta data: `@cloudflare/
// next-on-pages@1.13.16` processa `headers()` corretamente até o
// `routes-manifest.json` (a regra chega a ser embutida como objeto literal
// dentro do `_worker.js` compilado), mas o RUNTIME do worker nunca aplica
// essa tabela a nenhuma resposta — nem rota prerenderizada (`/`) nem rota
// dinâmica de verdade (`/api/health`, que devolvia `Access-Control-Allow-
// Origin: *` em vez do valor restrito configurado). Reproduzido 100% local
// (`npm run build:cf` + `wrangler pages dev` + curl), sem depender de nada
// da conta Cloudflare — não é cache, não é Transform Rule, não é domínio
// errado. CSP/X-Frame-Options/Permissions-Policy/COOP/CORP e o CORS
// restrito de /api/* NUNCA estiveram de fato ativos em produção, apesar do
// registro anterior (auditoria 13/09, PR #163) dizer "validado por curl" —
// aquela validação não pegou o bug (rodada contra uma combinação de
// versões ou um caminho que não reproduzia).
//
// Por que middleware e não `headers()`: middleware é RESSABIDAMENTE
// aplicado nesse adapter — prova, sem precisar de teoria: o `x-request-id`
// setado logo abaixo já chegava correto na resposta REAL de produção
// (confirmado num scan OWASP ZAP de 18/09/2026). `headers()` no
// next.config.mjs foi ESVAZIADO dos headers de segurança (só sobram as
// regras de no-cache do /portal, que não são afetadas pelo bug porque o
// valor delas já é o default do Next pra página dinâmica) — não recriar
// CSP/X-Frame-Options/etc lá: seria uma segunda fonte que não tem efeito
// nenhum em produção e confundiria a próxima sessão.
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://*.sentry-cdn.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.onrender.com https://challenges.cloudflare.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://sentry.io https://*.sentry.io https://cdn.jsdelivr.net https://storage.googleapis.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests";

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Content-Security-Policy', CSP],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'],
  ['X-Frame-Options', 'DENY'],
  [
    'Permissions-Policy',
    'microphone=(self), camera=(self), geolocation=(self), payment=(self), accelerometer=(), gyroscope=(), magnetometer=(), usb=()',
  ],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
];

// Mesma regra restrita de CORS que o next.config.mjs já declarava pra
// /api/* (as respostas OPTIONS 204 das rotas não mandavam header CORS
// nenhum sem isso) — igualmente sem efeito nenhum sob next-on-pages, pelo
// mesmo bug de cima. Sem Cache-Control aqui de propósito: cada rota
// gerencia o seu (/api/cidades cacheia no CDN intencionalmente).
const API_CORS_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Access-Control-Allow-Origin', 'https://queroumacor.com.br'],
  ['Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'],
  ['Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256, X-Internal-Secret'],
  ['Access-Control-Max-Age', '600'],
  ['Vary', 'Origin'],
];

function applySecurityHeaders(response: NextResponse, pathname: string): void {
  for (const [key, value] of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  if (pathname.startsWith('/api/')) {
    for (const [key, value] of API_CORS_HEADERS) {
      response.headers.set(key, value);
    }
  }
}

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
  // `new URL(request.url)` em vez de `request.nextUrl` de propósito: o
  // teste (`__tests__/api/middleware.test.ts`) simula `NextRequest` com um
  // `Request` (Web API) puro, que não tem `.nextUrl` — e essa é a MESMA
  // forma que o runtime real usa por baixo, então não perde nada.
  const pathname = new URL(request.url).pathname;

  const bloqueado = bloqueiaServerActionHeader(request);
  if (bloqueado) {
    applySecurityHeaders(bloqueado, pathname);
    return bloqueado;
  }

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
  applySecurityHeaders(response, pathname);
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
