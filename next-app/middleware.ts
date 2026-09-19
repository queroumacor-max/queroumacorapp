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

// Achado 2026-09-19 (investigação dos headers de segurança ausentes em
// produção, /, /feed, /login e /portal — reportado por scan ZAP de outra
// sessão): `headers()` do next.config.mjs era a fonte declarada, mas o
// `@cloudflare/next-on-pages` (adapter em produção hoje) embute essas
// regras num routes-manifest no estilo Vercel Build Output, e a entrada
// desse manifest que representa O PRÓPRIO MIDDLEWARE é marcada
// `override:true` — o motor de rotas do adapter ZERA os headers já
// acumulados sempre que uma requisição bate nessa entrada (função interna
// `applyRouteOverrides`, achada lendo o `_worker.js/index.js` gerado). Como
// o matcher abaixo casa quase toda rota (de propósito, pro bloqueio de
// `Next-Action`), isso zerava CSP/X-Frame-Options/Permissions-Policy/COOP/
// CORP em quase todo lugar — confirmado com um experimento controlado
// (estreitar o matcher fazia os headers voltarem, mas destruiria o
// bloqueio de CVE nas rotas de página — não era a correção, só a prova da
// causa) e, depois, com a correção abaixo, PROVADO fechando o bug de
// verdade num build real do `main` (`@cloudflare/next-on-pages`) rodando
// `wrangler pages dev` local — nunca commitado nessa forma, só validado.
//
// FIX: aplicar os headers de segurança AQUI, no próprio response que o
// middleware devolve, em vez de depender só do `headers()` do
// next.config.mjs (que SAIU de lá — ver comentário em next.config.mjs). O
// motor de rotas do adapter MERGEIA de volta os headers que o response do
// MIDDLEWARE já carrega (função interna `processMiddlewareResp`, roda
// DEPOIS do `applyRouteOverrides` zerar o acumulado) — setar aqui
// sobrevive ao mesmo mecanismo que zerava o que vinha do next.config.
// Confirmado nos DOIS adapters, com build real + servidor local em cada:
//   - `@opennextjs/cloudflare` (o desta branch): não reproduz o bug do
//     `override` (roda o middleware do Next de forma mais nativa), mas SE
//     os headers também ficassem declarados em next.config.mjs, as duas
//     fontes se combinavam por APPEND (não overwrite) na resposta final —
//     pra header de valor único isso saía `"DENY, DENY"`, formato que boa
//     parte dos navegadores não reconhece (podem ignorar a proteção em vez
//     de aplicá-la). Por isso next.config.mjs não declara mais esses
//     headers — só existe UMA fonte agora, aqui.
//   - `@cloudflare/next-on-pages` (produção hoje): reproduz o bug sem esta
//     correção; com ela, os headers aparecem certos (uma vez cada) em /,
//     /login, /feed, /portal e /api/*, inclusive na resposta 404 do
//     bloqueio de CVE — e o bloqueio de Next-Action continua barrando com
//     404 em toda rota testada, sem exceção.
//   - Ressalva do `@opennextjs/cloudflare`: `/portal` (arquivo estático
//     puro, `.open-next/assets/portal/index.html`) é servido pelo binding
//     `ASSETS` do Cloudflare direto — bypassa o worker/middleware por
//     inteiro (`CF-Cache-Status: HIT`, confirmado local), então NENHUM
//     header setado aqui chega nele nesse adapter especificamente. Sob
//     `@cloudflare/next-on-pages` isso não acontece (`/portal` passa pelo
//     worker como qualquer outra rota, ver `_routes.json`). Se/quando a
//     migração pros Workers for além de teste, fechar esse gap exige um
//     `_headers` dentro de `.open-next/assets/` (mecanismo nativo do
//     binding ASSETS) — não feito aqui, fora do escopo desta correção.
//
// MANTER EM SINCRONIA MANUAL com `__tests__/
// middlewareSecurityHeadersParidade.test.ts` (valores golden — falha se
// alguém editar um valor aqui sem querer) e com `_headers` da raiz, via
// `__tests__/cspHeadersParidade.test.ts` (mesmo padrão que este repo já
// usava entre `_headers` e a CSP — só que agora aponta pra cá).
const SECURITY_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://*.sentry-cdn.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.onrender.com https://challenges.cloudflare.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://sentry.io https://*.sentry.io https://cdn.jsdelivr.net https://storage.googleapis.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests";

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Content-Security-Policy', SECURITY_CSP],
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

const API_CORS_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Access-Control-Allow-Origin', 'https://queroumacor.com.br'],
  ['Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'],
  ['Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256, X-Internal-Secret'],
  ['Access-Control-Max-Age', '600'],
  ['Vary', 'Origin'],
];

// `/api/v1/:path*` é reescrito pra `/api/:path*` (rewrites do next.config),
// mas o middleware vê o pathname ORIGINAL, antes da rewrite resolver — por
// isso `/api/v1/...` já cai em `startsWith('/api/')` mesmo assim (é
// literalmente um prefixo da string), sem precisar de um segundo check.
function applySecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  for (const [key, value] of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  if (pathname.startsWith('/api/')) {
    for (const [key, value] of API_CORS_HEADERS) {
      response.headers.set(key, value);
    }
  }
  return response;
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
  // `new URL(request.url).pathname`, não `request.nextUrl.pathname`: os
  // dois valem o mesmo em runtime real, mas `nextUrl` é uma extensão só do
  // `NextRequest` — os testes existentes deste arquivo constroem um
  // `Request` (Fetch API padrão) e o castam pra `NextRequest`, sem essa
  // propriedade. `request.url` existe nos dois.
  const pathname = new URL(request.url).pathname;

  const bloqueado = bloqueiaServerActionHeader(request);
  if (bloqueado) return applySecurityHeaders(bloqueado, pathname);

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
  return applySecurityHeaders(response, pathname);
}

export const config = {
  // O bloqueio de `Next-Action` (acima) precisa valer em QUALQUER rota do
  // App Router — Server Actions são invocadas via POST na própria URL da
  // página, não só em /api/*. Exclui assets estáticos (_next/static,
  // _next/image, o service worker e afins) por custo, não por segurança:
  // eles não passam pelo pipeline de Actions de qualquer forma.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.json).*)'],
};
