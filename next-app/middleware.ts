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

// RECONCILIAÇÃO 2026-09-19: este achado foi feito de forma INDEPENDENTE em
// duas sessões Claude Code rodando em paralelo, cada uma sem saber da
// outra — uma direto em `main` (PR #350, disparada por 3 relatórios de
// scanner externo: CheckVibe/HostedScan Nmap + OWASP ZAP), outra dentro da
// branch de migração pros Workers (`claude/workers-migration-execution`,
// #344, disparada pelo achado do ZAP relatado no chat da outra sessão). As
// duas convergiram pro MESMO fix — headers de segurança de `headers()`
// (next.config.mjs) pra AQUI —, cada uma provando a causa e validando a
// correção contra um adapter diferente. Reconciliado no merge do #344.
//
// A CAUSA (achada pelas duas, provada com métodos diferentes): `headers()`
// do next.config.mjs processa certinho até o `routes-manifest.json` (a
// regra chega a ser embutida como objeto literal no `_worker.js`
// compilado), mas o RUNTIME do `@cloudflare/next-on-pages@1.13.16` nunca
// aplica essa tabela a nenhuma resposta — nem em rota prerenderizada (`/`)
// nem em rota dinâmica de verdade (`/api/health`, que devolvia
// `Access-Control-Allow-Origin: *` em produção em vez do valor restrito
// configurado — achado do lado do #350, batendo com o scan ZAP de
// 18/09/2026). O lado do #344 leu o mecanismo exato: a entrada do
// routes-manifest que representa O PRÓPRIO MIDDLEWARE é marcada
// `override:true`, e o motor de rotas do adapter ZERA os headers já
// acumulados sempre que uma requisição bate nela (função interna
// `applyRouteOverrides`, lida direto no `_worker.js/index.js` minificado).
// Como o matcher do middleware casa quase toda rota (de propósito, pro
// bloqueio de CVE de Next-Action), isso zerava CSP e os outros headers em
// quase todo lugar. **A validação "curl real via wrangler pages dev" que a
// auditoria de 13/09 (PR #163) registrou como prova NÃO pegou esse bug** —
// não dá pra saber daqui se foi versão diferente do adapter, path
// diferente testado, ou erro de método; o registro anterior estava errado
// e ninguém percebeu por meses.
//
// FIX: aplicar os headers de segurança AQUI, no próprio response que o
// middleware devolve — middleware É de fato aplicado nesse adapter (prova
// sem precisar de teoria: o `x-request-id` setado logo abaixo sempre
// chegou certo em produção, inclusive no próprio scan que achou o bug).
// `next.config.mjs` foi ESVAZIADO dos headers de segurança — não
// recriá-los lá: seria uma segunda fonte sem efeito nenhum em produção
// nesse adapter, e ainda por cima o lado do #344 provou que declarar nos
// DOIS lugares simultaneamente quebra sob `@opennextjs/cloudflare` (ver
// abaixo).
//
// Confirmado nos DOIS adapters, com build real + servidor local em cada:
//   - `@cloudflare/next-on-pages` (produção hoje): reproduz o bug do
//     `override` sem esta correção; com ela, os headers aparecem certos
//     (uma vez cada) em /, /login, /feed, /portal e /api/*, inclusive na
//     resposta 404 do bloqueio de CVE.
//   - `@opennextjs/cloudflare` (adapter da migração #344): NÃO reproduz o
//     bug do `override` (roda o middleware do Next de forma mais nativa),
//     mas SE os headers também ficassem declarados em next.config.mjs, as
//     duas fontes se combinavam por APPEND (não overwrite) na resposta
//     final — pra header de valor único isso saía `"DENY, DENY"`, formato
//     que boa parte dos navegadores não reconhece. Por isso next.config.mjs
//     não declara mais esses headers em NENHUM dos dois adapters — só
//     existe UMA fonte, aqui.
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
//   - **DIVERGÊNCIA REAL entre os dois adapters, achada na reconciliação**:
//     `/api/health` seta seu próprio `Access-Control-Allow-Origin: '*'` no
//     código da rota (de propósito, pra aceitar poll de uptime monitor
//     externo). O lado do #350 testou e confirmou que, sob
//     `@cloudflare/next-on-pages`, esse valor da ROTA sobrevive por cima do
//     valor restrito que este middleware seta. Testado de novo aqui, sob
//     `@opennextjs/cloudflare`: o valor do MIDDLEWARE é quem sobrevive —
//     `/api/health` sai com `https://queroumacor.com.br`, não `*`. Mesmo
//     código de middleware (`applySecurityHeaders` é idêntico nos dois),
//     resultado diferente — os dois adapters resolvem a ordem de merge
//     entre "header setado pelo middleware" e "header setado pela própria
//     rota" de jeitos opostos. Não há como o código deste arquivo forçar
//     um vencedor: quando o middleware roda, a rota ainda nem executou.
//     Efeito prático de baixa severidade (CORS só importa pra fetch feito
//     por JS de browser cross-origin; monitor de uptime típico chama
//     server-to-server, onde CORS não se aplica) — documentado, não
//     corrigido nesta reconciliação.
//
// MANTER EM SINCRONIA MANUAL com `__tests__/
// middlewareSecurityHeadersParidade.test.ts` (valores golden — falha se
// alguém editar um valor aqui sem querer) e com `_headers` da raiz, via
// `__tests__/cspHeadersParidade.test.ts` (mesmo padrão que este repo já
// usava entre `_headers` e a CSP — só que agora aponta pra cá).
//
// PENTEST (2026-09-19, achado reaberto depois de fechar #298 — a PR
// original implementava nonce em cima do `headers()` do `next.config.mjs`,
// que o achado ACIMA já provou nunca aplicar em produção nesse adapter;
// reimplementado do zero contra `middleware.ts`): `script-src` tinha
// `'unsafe-inline'`, que anula boa parte do valor de ter CSP — qualquer
// XSS que injete um `<script>` inline roda igual. Removido.
//
// Optou-se por HASH em vez de NONCE por request: nenhum dos scripts
// inline deste app carrega dado por-requisição (são strings estáticas —
// tema, fuso, pin de scroll do Android, o loader do Eruda, o retry da
// tela de erro, os 3 scripts do `/portal` estático) — um nonce por
// requisição exigiria ler `headers()` em Server Component pra repassar o
// valor, o que força TODA página coberta pelo middleware a virar
// dinâmica (perde geração estática das páginas de `/info/*`, sem
// necessidade real aqui) — e ainda dependeria do MESMO mecanismo de
// propagação de headers que este arquivo já documentou como
// adapter-dependente. Hash não tem nenhuma dessas dependências: casa
// pelo CONTEÚDO do script, então funciona igual em qualquer adapter,
// estático ou dinâmico.
//
// Cada hash abaixo (na ordem em que aparece em `script-src`) é sha256
// base64 do conteúdo EXATO (`__html`/RETRY/texto do `<script>`) de UM
// script: (1) app/layout.tsx tema claro/escuro; (2) app/layout.tsx patch
// de fuso horário (Brasília); (3) app/layout.tsx pin de scroll
// pré-hidratação (Android pull-to-refresh); (4) app/layout.tsx loader do
// Eruda (só builds com NEXT_PUBLIC_ENABLE_ERUDA=1); (5) components/
// TelaReconectando.tsx auto-retry da tela de erro 500/offline; (6)
// public/portal/index.html init do Sentry loader; (7) public/portal/
// index.html patch de fuso horário; (8) public/portal/index.html config
// SUPA_URL/SUPA_KEY. `__tests__/lib/csp-script-hashes.test.ts` recalcula
// os 8 a partir do fonte real e falha se um sair de sincronia com o que
// está aqui — editar QUALQUER um desses scripts sem rodar esse teste
// quebra o script em produção (CSP bloqueia silenciosamente, sem erro
// visível pra quem não olhar o console).
const SECURITY_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-1g/4/q5hhnu9i8wkSe7iaa6xAsgBLnRt2ax5yKttwrs=' 'sha256-JDH5f4Zr1/oCxPN2ffwQpeNHP+q6sofe4JbkmgTK6oc=' 'sha256-aTvPZGOmLmPxnWSX8uEtE5pFy1yfeYOI6lTfU3psjdA=' 'sha256-caEV9gkPUz2B2VLH1MN8r5EizN6XNLSsLBdR7Y9fMRI=' 'sha256-G8Md6VEAAcAjKEG9ogYeZK8mUsQ7rrspan0dYs0hn/Y=' 'sha256-PquLsr6mOLBhSht5Miv4NtZLYudIBM9OUsQTGpg7HWk=' 'sha256-a4J5SJlV3SCB71i33BogdJGZX6n6xmq3L8YJouWP2W8=' 'sha256-VRBxUNHFhE1rpWdbNycJro9J4GW/Ag8zF5dGCi7ujT0=' https://challenges.cloudflare.com https://*.sentry-cdn.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.onrender.com https://challenges.cloudflare.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://sentry.io https://*.sentry.io https://cdn.jsdelivr.net https://storage.googleapis.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests";

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

// Mesma regra restrita de CORS que o next.config.mjs já declarava pra
// /api/* (as respostas OPTIONS 204 das rotas não mandavam header CORS
// nenhum sem isso) — igualmente sem efeito sob next-on-pages, pelo mesmo
// bug de cima. Sem Cache-Control aqui de propósito: cada rota gerencia o
// seu (/api/cidades cacheia no CDN intencionalmente).
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
  // `NextRequest` — o teste (`__tests__/api/middleware.test.ts`) simula
  // `NextRequest` com um `Request` (Fetch API padrão) castado, sem essa
  // propriedade. `request.url` existe nos dois, e é a mesma forma que o
  // runtime real usa por baixo — não perde nada.
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
