// Next.js config — migração Path C do QueroUmaCor vanilla → Next.js+TS+React.
// Coexiste com o app vanilla em / durante a migração (deploy paralelo via
// Cloudflare Pages: pages.dev novo project OU subdomain app2.queroumacor.com.br).

import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Env vars passadas EXPLICITAMENTE pro client bundle. Resolve o problema
  // do Cloudflare Pages exportar env vars como "secrets" (só runtime) — o
  // Next.js precisa dos NEXT_PUBLIC_* DURANTE O BUILD pra inlinar no bundle.
  //
  // Fallback chain:
  //   1. NEXT_PUBLIC_* (se setado no painel CF Pages)
  //   2. var sem prefixo (também setada no painel)
  //   3. URL hardcoded (Supabase URL é PÚBLICO — já está em lib/config.ts
  //      e estava no vanilla head.js). Anon key sem fallback hardcoded —
  //      se chegar undefined, supabase.ts estoura no client com mensagem
  //      clara, e build segue (pra não bloquear deploy).
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
  },

  // ESLint durante o build: DESLIGADO pra evitar quebrar deploy por causa
  // de dependência transitiva corrupta (es-abstract/2024 missing) no
  // eslint-plugin-react. Lint roda separadamente via `npm run lint`
  // localmente + workflow CI (`.github/workflows/conventions.yml`).
  eslint: {
    ignoreDuringBuilds: true,
  },

  // TypeScript: NÃO ignorar — tsc --noEmit roda separadamente em CI
  // mas o build do Next também check, e queremos pegar regressão tipada.
  typescript: {
    ignoreBuildErrors: false,
  },

  // Versionamento de API: `/api/v1/*` é alias pra `/api/*` (versão atual).
  // Espelha o `_redirects` do projeto vanilla (Backend#21) — mantém
  // backward-compat para clientes que já apontam pra v1. Quando vier
  // quebra de contrato, criar `/api/v2/<endpoint>` e manter v1 até
  // desativação.
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: '/api/:path*' },
      // /portal (sem slash final) → index.html do admin estático em public/portal.
      // Sem isso o Next tenta resolver como App Router page e dá 404.
      { source: '/portal', destination: '/portal/index.html' },
    ];
  },

  // Cabeçalhos de segurança alinhados com /_headers do projeto vanilla.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },

  // Sentry: integrado via @sentry/nextjs (auto-wraps API routes + RSC).
  // DSN do projeto queroumacor-app: e19aa766953a6e70aeb09a52ea1046a7.
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
