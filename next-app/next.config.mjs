// Next.js config — migração Path C do QueroUmaCor vanilla → Next.js+TS+React.
// Coexiste com o app vanilla em / durante a migração (deploy paralelo via
// Cloudflare Pages: pages.dev novo project OU subdomain app2.queroumacor.com.br).

import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      'https://uwqebaqweehiljsqkifm.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      '',
    NEXT_PUBLIC_SENTRY_DSN:
      process.env.NEXT_PUBLIC_SENTRY_DSN ||
      process.env.SENTRY_DSN ||
      '',
    // Marca da build, mostrada no /diag. Existe por causa de uma pergunta que
    // já apareceu em três investigações e nunca teve resposta: "o aparelho
    // está rodando a correção ou o bundle velho?". Sem isso, testar depois de
    // um deploy é ato de fé — e o service worker serve `/_next/static/`
    // cache-first, então um aparelho PODE ficar preso numa build anterior.
    // O SHA vem do Cloudflare Pages; local/preview cai pro horário do build.
    NEXT_PUBLIC_BUILD:
      (process.env.CF_PAGES_COMMIT_SHA || '').slice(0, 7) ||
      new Date().toISOString().slice(0, 16).replace('T', ' '),
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: false,
  },

  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: '/api/:path*' },
      { source: '/portal', destination: '/portal/index.html' },
    ];
  },

  async headers() {
    const noCache = [
      { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
    ];
    // FIX C2 (auditoria 2026-08-26): estes headers viviam só no `_headers`
    // da RAIZ do repo, que fica fora do output do build — produção rodava sem
    // eles. O `_headers` da raiz é legado do app vanilla e NÃO entra no
    // deploy; a fonte é este arquivo (rotas servidas pelo worker, /api/*
    // incluso). NÃO recriar `public/_headers` com CSP: seria uma segunda
    // política divergente.
    //
    // A Content-Security-Policy NÃO está mais aqui (pentest Strix,
    // 2026-09-11): ela precisa de um NONCE por request pra dispensar o
    // 'unsafe-inline' em script-src, e header estático não tem como carregar
    // isso. Vive em `lib/csp.ts`, emitida pelo `middleware.ts` — inclusive a
    // do /portal (por hash) e a exceção do /pdf (CSP própria da rota).
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(self), geolocation=(self), payment=(self), accelerometer=(), gyroscope=(), magnetometer=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      {
        // CORS restrito ao próprio domínio pras rotas de API (as respostas
        // OPTIONS 204 das rotas não mandavam header CORS nenhum). Sem
        // Cache-Control aqui de propósito: cada rota gerencia o seu
        // (/api/cidades cacheia no CDN intencionalmente).
        source: '/api/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://queroumacor.com.br' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Hub-Signature-256, X-Internal-Secret' },
          { key: 'Access-Control-Max-Age', value: '600' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
      { source: '/portal', headers: noCache },
      { source: '/portal/', headers: noCache },
      { source: '/portal/index.html', headers: noCache },
    ];
  },

  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000', 'queroumacor.com.br', '*.queroumacor.com.br'] },
  },
};

export default withSentryConfig(nextConfig, {
  org: 'q87',
  project: 'queroumacor-app',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
