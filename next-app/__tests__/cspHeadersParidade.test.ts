// Auditoria de segurança mobile (2026-09-13) — a CSP vive em DOIS lugares que
// têm que se complementar (comentário em next.config.mjs, "mudou um, mude o
// outro"): `_headers` da raiz (assets estáticos/páginas prerenderizadas no
// Cloudflare Pages) e `headers()` do next.config.mjs (rotas servidas pelo
// worker). Encontrado NA PRÁTICA um drift real: `_headers` estava sem
// `https://*.supabase.co` em `media-src`, então uma página prerenderizada
// (ex.: `/feed`, que sai como estática no build) podia bloquear `<video>`/
// `<audio>` apontando pro Storage do Supabase — WhatsApp media, posts em
// vídeo — enquanto a MESMA rota servida pelo worker liberava normalmente.
// Este teste falha se os dois voltarem a divergir.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function cspFromHeadersFile(): string {
  const raw = readFileSync('../_headers', 'utf8');
  const line = raw.split('\n').find((l) => l.includes('Content-Security-Policy'));
  if (!line) throw new Error('_headers sem linha Content-Security-Policy');
  return line.replace(/^\s*Content-Security-Policy:\s*/, '').trim();
}

function cspFromNextConfig(): string {
  const raw = readFileSync('next.config.mjs', 'utf8');
  const m = raw.match(/const csp =\s*\n\s*"([^"]*)"/);
  if (!m) throw new Error('next.config.mjs sem `const csp = "..."` no formato esperado');
  return m[1];
}

describe('CSP: raiz `_headers` e `next.config.mjs` não podem divergir', () => {
  it('o valor do header Content-Security-Policy é IDÊNTICO nos dois arquivos', () => {
    expect(cspFromHeadersFile()).toBe(cspFromNextConfig());
  });
});
