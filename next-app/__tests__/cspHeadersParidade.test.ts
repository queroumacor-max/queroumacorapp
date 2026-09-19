// Auditoria de segurança mobile (2026-09-13) — a CSP vivia em DOIS lugares
// que tinham que se complementar: `_headers` da raiz (relíquia inerte, o
// Cloudflare Pages não lê nada fora do build output — só documentação) e
// `headers()` do next.config.mjs. Este teste comparava os dois.
//
// ATUALIZADO (2026-09-19): `headers()` no next.config.mjs deixou de ser a
// fonte real — achado e provado que `@cloudflare/next-on-pages@1.13.16`
// processa `headers()` até o `routes-manifest.json`, mas o RUNTIME do
// worker nunca aplica essa tabela a nenhuma resposta (CSP/X-Frame-Options/
// Permissions-Policy/COOP/CORP nunca estiveram de fato ativos em produção
// por esse caminho). A CSP migrou pra `middleware.ts`, que É aplicado de
// fato nesse adapter. Este teste agora compara `_headers` (documentação)
// contra `middleware.ts` (fonte real) — ver `next.config.mjs` e
// `middleware.ts` pro raciocínio completo.

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
  const m = raw.match(/const CSP =\s*\n\s*"([^"]*)"/);
  if (!m) throw new Error('middleware.ts sem `const CSP = "..."` no formato esperado');
  return m[1];
}

describe('CSP: raiz `_headers` e `middleware.ts` não podem divergir', () => {
  it('o valor do header Content-Security-Policy é IDÊNTICO nos dois arquivos', () => {
    expect(cspFromHeadersFile()).toBe(cspFromMiddleware());
  });
});
