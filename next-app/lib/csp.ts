// lib/csp.ts — a Content-Security-Policy do app, em UM lugar.
//
// Pentest Strix (2026-09-11): a CSP tinha `'unsafe-inline'` em `script-src`,
// o que anula a proteção contra XSS — qualquer `<script>` injetado rodava.
// Agora o `middleware.ts` gera um NONCE por request e o emite aqui; o Next
// carimba o nonce nos scripts DELE sozinho (hidratação, chunks, payload RSC)
// — ele lê o header `content-security-policy` da REQUEST, por isso o
// middleware seta a CSP nos headers da request E da response.
//
// Os inline NOSSOS entram por HASH (`'sha256-…'`), não por nonce:
//   - `app/layout.tsx` (tema, fuso de Brasília, pin do Android; Eruda só fora
//     de produção): ler o nonce ali exigiria `headers()`, que torna a rota
//     `/_not-found` dinâmica — e essa rota NÃO herda o `runtime = 'edge'` do
//     layout (o Next monta ela a partir de um arquivo builtin fora do
//     `app/`), então viraria função Node e o `build:cf` do next-on-pages
//     recusa o deploy. Hash tem a mesma força do nonce pra conteúdo fixo.
//   - `/portal` é HTML ESTÁTICO (`public/portal/index.html`) com três inline.
//   - o auto-retry inline da `TelaReconectando` (pages/500 e pages/_error).
// Mudou UM caractere num desses scripts? `__tests__/csp-nonce.test.ts`
// recalcula do fonte e aponta o hash novo — sem atualizar, o script é
// bloqueado em SILÊNCIO (portal eterno em "Carregando", tema sem aplicar,
// auto-retry morto), igual ao SRI do app.js.
//
// `style-src` MANTÉM `'unsafe-inline'` de propósito: o app tem ~1.260
// atributos `style={{…}}` (React + SSR), e nonce/hash cobrem só elementos
// `<style>`, nunca atributos — sem `'unsafe-inline'` todo `style="…"`
// renderizado no servidor seria descartado pelo navegador no parse. O ganho
// de segurança da CSP está no `script-src`; XSS por CSS é bem mais restrito.
//
// A rota `/pdf/[id]` (visualizador HTML gerado no handler) tem CSP PRÓPRIA,
// com nonce por resposta, e o middleware NÃO a sobrescreve (`cspParaPath`
// devolve null lá).

/** Hash sha256 (base64) de cada `<script>` inline de `app/layout.tsx` que vai pra produção. */
export const LAYOUT_SCRIPT_HASHES = [
  'sha256-1g/4/q5hhnu9i8wkSe7iaa6xAsgBLnRt2ax5yKttwrs=', // tema claro/escuro (data-theme)
  'sha256-JDH5f4Zr1/oCxPN2ffwQpeNHP+q6sofe4JbkmgTK6oc=', // fuso de Brasília nos toLocale*
  'sha256-aTvPZGOmLmPxnWSX8uEtE5pFy1yfeYOI6lTfU3psjdA=', // pin pré-hidratação do Android
] as const;

/** Hash do carregador do Eruda — só existe no bundle fora de produção. */
export const ERUDA_SCRIPT_HASH = 'sha256-caEV9gkPUz2B2VLH1MN8r5EizN6XNLSsLBdR7Y9fMRI=';

/** Hash sha256 (base64) de cada `<script>` inline de `public/portal/index.html`. */
export const PORTAL_SCRIPT_HASHES = [
  'sha256-PquLsr6mOLBhSht5Miv4NtZLYudIBM9OUsQTGpg7HWk=', // Sentry.onLoad
  'sha256-a4J5SJlV3SCB71i33BogdJGZX6n6xmq3L8YJouWP2W8=', // patch de fuso (Brasília)
  'sha256-VRBxUNHFhE1rpWdbNycJro9J4GW/Ag8zF5dGCi7ujT0=', // SUPA_URL / SUPA_KEY
] as const;

/** Hash sha256 (base64) do script RETRY de `components/TelaReconectando.tsx`. */
export const RETRY_SCRIPT_HASH = 'sha256-G8Md6VEAAcAjKEG9ogYeZK8mUsQ7rrspan0dYs0hn/Y=';

// Hosts de script fora do próprio domínio. Turnstile, Sentry (loader do
// portal) e jsDelivr — este último NÃO é só o Eruda (que saiu de produção):
// o `WallARView` carrega o WASM do MediaPipe de lá.
const SCRIPT_HOSTS =
  'https://challenges.cloudflare.com https://*.sentry-cdn.com https://cdn.jsdelivr.net';

// Diretivas que não dependem de nonce. Validadas em produção (PR #163);
// `*.onrender.com` cobre a Evolution API do WhatsApp. NÃO estreitar `img-src`
// sem inventariar de onde vêm as fotos (Supabase Storage, cdn-cgi do próprio
// domínio, avatar do OAuth do Google, catálogo importado).
const DIRETIVAS_FIXAS = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.onrender.com https://challenges.cloudflare.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://sentry.io https://*.sentry.io https://cdn.jsdelivr.net https://storage.googleapis.com",
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
];

/** Gera um nonce novo (base64 de um UUID v4). `btoa` existe em edge, node e navegador. */
export function gerarNonce(): string {
  return btoa(crypto.randomUUID());
}

/** Hashes dos inline nossos que podem aparecer numa página do App Router. */
export function hashesDoApp(producao = process.env.NODE_ENV === 'production'): string[] {
  const lista: string[] = [...LAYOUT_SCRIPT_HASHES, RETRY_SCRIPT_HASH];
  if (!producao) lista.push(ERUDA_SCRIPT_HASH);
  return lista;
}

/** CSP das páginas do App Router: scripts do Next pelo nonce desta request, os nossos por hash. */
export function cspComNonce(nonce: string): string {
  const hashes = hashesDoApp()
    .map((h) => `'${h}'`)
    .join(' ');
  return [
    DIRETIVAS_FIXAS[0],
    `script-src 'self' 'nonce-${nonce}' ${hashes} 'wasm-unsafe-eval' ${SCRIPT_HOSTS}`,
    ...DIRETIVAS_FIXAS.slice(1),
  ].join('; ');
}

/** CSP do portal estático: os três inline entram por hash, sem `'unsafe-inline'`. */
export function cspDoPortal(): string {
  const hashes = PORTAL_SCRIPT_HASHES.map((h) => `'${h}'`).join(' ');
  return [
    DIRETIVAS_FIXAS[0],
    `script-src 'self' ${hashes} 'wasm-unsafe-eval' ${SCRIPT_HOSTS}`,
    ...DIRETIVAS_FIXAS.slice(1),
  ].join('; ');
}

/**
 * Decide a CSP pelo caminho da request. `null` = o middleware não emite CSP
 * (a rota responde com a sua própria).
 */
export function cspParaPath(pathname: string, nonce: string): string | null {
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return cspDoPortal();
  if (pathname === '/pdf' || pathname.startsWith('/pdf/')) return null;
  return cspComNonce(nonce);
}
