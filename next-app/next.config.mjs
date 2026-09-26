// Next.js config — migração Path C do QueroUmaCor vanilla → Next.js+TS+React.
// Coexiste com o app vanilla em / durante a migração (deploy paralelo via
// Cloudflare Pages). Histórico: o subdomain app2 dessa fase foi removido em 2026-09-26.

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
    // SEGURANÇA (2026-09-19): CSP/X-Frame-Options/Permissions-Policy/COOP/
    // CORP e o CORS restrito de /api/* SAÍRAM daqui — achado e provado nesta
    // data que `@cloudflare/next-on-pages@1.13.16` processa `headers()`
    // corretamente até o `routes-manifest.json`, mas o RUNTIME do worker
    // nunca aplica essa tabela a nenhuma resposta (reproduzido local com
    // `npm run build:cf` + `wrangler pages dev` + curl, inclusive em rota
    // dinâmica de verdade como `/api/health` — não é cache, não é Transform
    // Rule, não é domínio errado). Esses headers vivem agora em
    // `middleware.ts`, que É aplicado de fato nesse adapter (prova: o
    // `x-request-id` setado lá sempre chegou certo em produção).
    // NÃO recriar esses headers aqui — seria uma segunda fonte sem efeito
    // nenhum em produção, e confundiria a próxima sessão a achar que estão
    // duplamente protegidos.
    const noCache = [
      { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
    ];
    // RECONCILIAÇÃO 2026-09-19: esta correção foi achada e corrigida de
    // forma INDEPENDENTE em duas sessões em paralelo — uma direto em `main`
    // (PR #350, contra `@cloudflare/next-on-pages`) e outra dentro da
    // branch de migração pros Workers (`claude/workers-migration-execution`,
    // #344, já contra `@opennextjs/cloudflare`). As duas convergiram pro
    // MESMO fix (mover pra middleware.ts) de forma independente — reconciliado
    // no merge do #344 em main, mantendo os achados dos dois lados (ver
    // `middleware.ts` e CLAUDE.md pro detalhe completo, incluindo uma
    // divergência real de comportamento entre os dois adapters pro CORS de
    // `/api/health`).
    return [
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
