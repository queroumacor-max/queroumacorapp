// Auditoria de segurança mobile (2026-09-13) — a CSP vive em DOIS lugares que
// têm que se complementar: `_headers` da raiz (relíquia inerte no Cloudflare
// Pages — nada fora do build output é lido de lá, é só documentação) e a
// fonte real da CSP (rotas servidas pelo worker). Encontrado NA PRÁTICA um
// drift real (antes desta data): `_headers` estava sem
// `https://*.supabase.co` em `media-src`, então uma página prerenderizada
// (ex.: `/feed`, que sai como estática no build) podia bloquear `<video>`/
// `<audio>` apontando pro Storage do Supabase — WhatsApp media, posts em
// vídeo — enquanto a MESMA rota servida pelo worker liberava normalmente.
// Este teste falha se os dois voltarem a divergir.
//
// ATUALIZADO 2026-09-19 (achado de forma independente em duas sessões em
// paralelo, reconciliado no merge do #344 em main): `headers()` no
// next.config.mjs deixou de ser a fonte real — achado e provado que
// `@cloudflare/next-on-pages@1.13.16` processa `headers()` até o
// `routes-manifest.json`, mas o RUNTIME do worker nunca aplica essa tabela a
// nenhuma resposta (CSP/X-Frame-Options/Permissions-Policy/COOP/CORP nunca
// estiveram de fato ativos em produção por esse caminho — bug do
// `override:true` do adapter, que zerava exatamente esses headers). A CSP
// migrou pra `middleware.ts` (`applySecurityHeaders`/`SECURITY_CSP`), que É
// aplicado de fato nesse adapter. Este teste agora compara `_headers`
// (documentação) contra `middleware.ts` (fonte real) — ver `next.config.mjs`
// e `middleware.ts` pro raciocínio completo, incluindo uma divergência real
// de comportamento entre os dois adapters pro CORS de `/api/health`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function cspFromHeadersFile(): string {
  const raw = readFileSync('../_headers', 'utf8');
  const line = raw.split('\n').find((l) => l.includes('Content-Security-Policy'));
  if (!line) throw new Error('_headers sem linha Content-Security-Policy');
  return line.replace(/^\s*Content-Security-Policy:\s*/, '').trim();
}

function cspFromMiddleware(): string {
  const raw = readFileSync('middleware.ts', 'utf8');
  const m = raw.match(/const SECURITY_CSP =\s*\n?\s*"([^"]*)"/);
  if (!m) throw new Error('middleware.ts sem `const SECURITY_CSP = "..."` no formato esperado');
  return m[1];
}

describe('CSP: raiz `_headers` e `middleware.ts` não podem divergir', () => {
  it('o valor do header Content-Security-Policy é IDÊNTICO nos dois arquivos', () => {
    expect(cspFromHeadersFile()).toBe(cspFromMiddleware());
  });
});
