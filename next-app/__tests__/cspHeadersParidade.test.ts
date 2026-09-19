// Auditoria de segurança mobile (2026-09-13) — a CSP vive em DOIS lugares que
// têm que se complementar (comentário em next.config.mjs, "mudou um, mude o
// outro"): `_headers` da raiz (assets estáticos/páginas prerenderizadas no
// Cloudflare Pages) e a fonte real da CSP (rotas servidas pelo worker).
// Encontrado NA PRÁTICA um drift real: `_headers` estava sem
// `https://*.supabase.co` em `media-src`, então uma página prerenderizada
// (ex.: `/feed`, que sai como estática no build) podia bloquear `<video>`/
// `<audio>` apontando pro Storage do Supabase — WhatsApp media, posts em
// vídeo — enquanto a MESMA rota servida pelo worker liberava normalmente.
// Este teste falha se os dois voltarem a divergir.
//
// ATUALIZADO 2026-09-19: a CSP (e os outros headers de segurança) saiu do
// `headers()` de `next.config.mjs` e foi pra `middleware.ts` — ver o
// comentário lá (`applySecurityHeaders`/`SECURITY_CSP`) pro porquê (bug do
// `override:true` no adapter de produção, que zerava exatamente esses
// headers). A fonte comparada contra `_headers` agora é `middleware.ts`.

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
