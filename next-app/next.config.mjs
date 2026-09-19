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
    // CSP/X-Frame-Options/Permissions-Policy/COOP/CORP e o CORS de /api/(.*)
    // SAÍRAM de headers() em 2026-09-19 e foram pra `middleware.ts`
    // (função `applySecurityHeaders`) — NÃO removidos, MOVIDOS.
    //
    // Por quê: o `@cloudflare/next-on-pages` (adapter de produção hoje)
    // embute as regras deste headers() num routes-manifest interno estilo
    // Vercel Build Output, e a entrada desse manifest que representa o
    // MIDDLEWARE é `override:true` — o motor de rotas do adapter ZERA os
    // headers já acumulados (inclusive os deste headers()) sempre que uma
    // requisição bate no middleware. Como o matcher do middleware casa
    // quase toda rota (de propósito, pro bloqueio de CVE de Next-Action),
    // isso zerava CSP e os outros headers em quase todo lugar — provado
    // com build real + `wrangler pages dev` contra produção (investigação
    // 2026-09-19), depois de outra sessão reportar o sintoma via scan ZAP.
    // Manter a declaração AQUI *e* no middleware duplicaria o header (uma
    // fonte sobrevive ao `override`, a outra não, e as duas se combinam
    // por append em vez de overwrite) — pra X-Frame-Options/Permissions-
    // Policy isso sai como `"DENY, DENY"`, que é formato NÃO reconhecido
    // pela maioria dos navegadores (podem tratar como header inválido e
    // deixar de aplicar a proteção) — comprovado rodando local contra o
    // build desta branch (`@opennextjs/cloudflare`, que não reproduz o
    // bug do `override` mas SOFRE esse duplicado se os dois lados
    // declararem o mesmo header).
    //
    // Fonte única hoje: `middleware.ts`. Ver `SECURITY_HEADERS`/
    // `API_CORS_HEADERS`/`SECURITY_CSP` lá. Guardado por
    // `__tests__/cspHeadersParidade.test.ts` (contra o `_headers` legado
    // da raiz — inerte em produção, mas mantido documentado).
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
