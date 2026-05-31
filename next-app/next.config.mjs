// Next.js config — migração Path C do QueroUmaCor vanilla → Next.js+TS+React.
// Coexiste com o app vanilla em / durante a migração (deploy paralelo via
// Cloudflare Pages: pages.dev novo project OU subdomain app2.queroumacor.com.br).

import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

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
