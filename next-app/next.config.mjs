// Next.js config — migração Path C do QueroUmaCor vanilla → Next.js+TS+React.
// Coexiste com o app vanilla em / durante a migração (deploy paralelo via
// Cloudflare Pages: pages.dev novo project OU subdomain app2.queroumacor.com.br).

import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

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
