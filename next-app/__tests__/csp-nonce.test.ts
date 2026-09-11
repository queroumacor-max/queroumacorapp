// __tests__/csp-nonce.test.ts — CSP com nonce (pentest Strix, 2026-09-11).
//
// O que este arquivo trava:
//   1. o middleware emite CSP com nonce por request, SEM 'unsafe-inline' em
//      script-src, e manda o nonce pro Next (header da request) e pro layout
//      (`x-nonce`);
//   2. os hashes hardcoded em `lib/csp.ts` batem com o conteúdo REAL dos
//      inline do portal e do auto-retry — mudou o script, o teste diz o hash
//      novo (mesma disciplina do SRI do app.js);
//   3. os inline do layout raiz entram por hash (ler o nonce exigiria
//      `headers()`, que tornaria a /_not-found dinâmica — e ela não roda no
//      edge) e o Eruda só existe fora de produção;
//   4. ninguém devolve `Access-Control-Allow-Origin: *`, o `X-Powered-By`
//      está desligado e a CSP não voltou pro next.config (duas fontes).

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import {
  ERUDA_SCRIPT_HASH,
  LAYOUT_SCRIPT_HASHES,
  PORTAL_SCRIPT_HASHES,
  RETRY_SCRIPT_HASH,
  cspComNonce,
  cspDoPortal,
  cspParaPath,
  hashesDoApp,
} from '@/lib/csp';
import { RETRY } from '@/components/TelaReconectando';

const RAIZ = join(__dirname, '..');

function mkReq(path: string, headers: Record<string, string> = {}): NextRequest {
  return new Request(`https://app.test${path}`, { headers }) as unknown as NextRequest;
}

function sha256(texto: string): string {
  return 'sha256-' + createHash('sha256').update(texto, 'utf8').digest('base64');
}

function diretiva(csp: string, nome: string): string {
  const d = csp
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(nome + ' '));
  if (!d) throw new Error(`CSP sem diretiva ${nome}: ${csp}`);
  return d;
}

// Tira comentários de linha e de bloco (JSX incluso) — os testes olham CÓDIGO, não prosa.
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function arquivosSob(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...arquivosSob(p, exts));
    else if (exts.some((e) => nome.endsWith(e))) out.push(p);
  }
  return out;
}

describe('middleware → CSP com nonce', () => {
  it('página do app: nonce por request, sem unsafe-inline em script-src', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq('/feed'));
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    const script = diretiva(csp!, 'script-src');
    const nonce = script.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).toContain(`'${RETRY_SCRIPT_HASH}'`);
    // O Next lê o nonce do header `content-security-policy` da REQUEST; o
    // layout lê `x-nonce`. NextResponse.next expõe os headers reescritos da
    // request como `x-middleware-request-*`.
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });

  it('nonce muda a cada request', async () => {
    const { middleware } = await import('@/middleware');
    const a = middleware(mkReq('/feed')).headers.get('x-middleware-request-x-nonce');
    const b = middleware(mkReq('/feed')).headers.get('x-middleware-request-x-nonce');
    expect(a).not.toBe(b);
  });

  it('o resto da política não mudou (Supabase, Sentry, Turnstile, frame-ancestors)', () => {
    const csp = cspComNonce('abc');
    expect(diretiva(csp, 'connect-src')).toContain('https://*.supabase.co');
    expect(diretiva(csp, 'connect-src')).toContain('wss://*.supabase.co');
    expect(diretiva(csp, 'img-src')).toContain('https:');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(diretiva(csp, 'script-src')).toContain('https://challenges.cloudflare.com');
    // style-src mantém 'unsafe-inline' DE PROPÓSITO: nonce não cobre os
    // ~1.260 atributos style={{…}} do app (ver comentário em lib/csp.ts).
    expect(diretiva(csp, 'style-src')).toContain("'unsafe-inline'");
  });

  it('/portal recebe a CSP por hash (HTML estático, sem nonce)', async () => {
    const { middleware } = await import('@/middleware');
    for (const path of ['/portal', '/portal/', '/portal/index.html']) {
      const csp = middleware(mkReq(path)).headers.get('Content-Security-Policy');
      expect(csp).toBe(cspDoPortal());
      expect(csp).not.toContain("'nonce-");
      expect(diretiva(csp!, 'script-src')).not.toContain("'unsafe-inline'");
    }
  });

  it('/pdf/* fica com a CSP da própria rota (middleware não emite)', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq('/pdf/abc-123'));
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(cspParaPath('/pdf/x', 'n')).toBeNull();
    // e /api continua ganhando x-request-id como sempre
    expect(middleware(mkReq('/api/health')).headers.get('x-request-id')).toBeTruthy();
  });
});

describe('hashes da CSP batem com o conteúdo real', () => {
  it('cada <script> inline de public/portal/index.html está na CSP do portal', () => {
    const html = readFileSync(join(RAIZ, 'public/portal/index.html'), 'utf8');
    const inlines = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inlines.length).toBeGreaterThan(0);
    const reais = inlines.map(sha256);
    // Mensagem útil: qual hash trocar em lib/csp.ts.
    expect(reais).toEqual([...PORTAL_SCRIPT_HASHES]);
    // e <script src> inline com atributos (ex.: defer) NÃO é inline — o
    // portal não pode ter `<script>` com handler ou src+conteúdo.
    expect(html).not.toMatch(/<script[^>]+>[^<\s][\s\S]*?<\/script>/);
  });

  it('o auto-retry da TelaReconectando está na CSP por hash', () => {
    expect(sha256(RETRY)).toBe(RETRY_SCRIPT_HASH);
  });

  it('cada <script> inline do app/layout.tsx está na CSP por hash', () => {
    const src = readFileSync(join(RAIZ, 'app/layout.tsx'), 'utf8');
    const inlines = [...src.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html: `([^`]*)`/g)].map(
      (m) => m[1],
    );
    expect(inlines.length).toBe(4);
    // O hash é do texto que o navegador vê; template literal com escape ou
    // interpolação NÃO é o texto do fonte — o teste recusa pra não mentir.
    for (const s of inlines) expect(s).not.toMatch(/\\|\$\{/);
    const [tema, fuso, pin, eruda] = inlines.map(sha256);
    expect([tema, fuso, pin]).toEqual([...LAYOUT_SCRIPT_HASHES]);
    expect(eruda).toBe(ERUDA_SCRIPT_HASH);
    // Em produção o Eruda não existe — e o hash dele também não.
    expect(hashesDoApp(true)).not.toContain(ERUDA_SCRIPT_HASH);
    expect(hashesDoApp(false)).toContain(ERUDA_SCRIPT_HASH);
    expect(hashesDoApp(true)).toEqual([...LAYOUT_SCRIPT_HASHES, RETRY_SCRIPT_HASH]);
  });
});

describe('layout raiz e config', () => {
  const layout = semComentarios(readFileSync(join(RAIZ, 'app/layout.tsx'), 'utf8'));

  it('layout raiz: edge (desliga o estático) e SEM headers() (a /_not-found não roda no edge)', () => {
    expect(layout).toMatch(/export const runtime = 'edge'/);
    expect(layout).not.toContain("from 'next/headers'");
    expect(layout).not.toContain('headers()');
  });

  it('Eruda só fora de produção', () => {
    const i = layout.indexOf('eruda');
    expect(i).toBeGreaterThan(0);
    const antes = layout.slice(0, i);
    expect(antes).toContain("process.env.NODE_ENV !== 'production'");
  });

  it('next.config: X-Powered-By desligado, CSP não voltou pra lá', () => {
    const cfg = semComentarios(readFileSync(join(RAIZ, 'next.config.mjs'), 'utf8'));
    expect(cfg).toMatch(/poweredByHeader:\s*false/);
    expect(cfg).not.toMatch(/key:\s*'Content-Security-Policy'/);
    expect(cfg).not.toContain('unsafe-inline');
  });

  it("nenhuma rota devolve Access-Control-Allow-Origin: '*'", () => {
    const arquivos = [
      ...arquivosSob(join(RAIZ, 'app'), ['.ts', '.tsx']),
      ...arquivosSob(join(RAIZ, 'lib'), ['.ts', '.tsx']),
      join(RAIZ, 'next.config.mjs'),
      join(RAIZ, 'middleware.ts'),
    ];
    for (const f of arquivos) {
      const src = readFileSync(f, 'utf8');
      // Case-insensitive: o /api/health escrevia `'access-control-allow-origin': '*'`
      // em minúsculas e passou batido numa busca sensível a caixa.
      expect(src, f).not.toMatch(/access-control-allow-origin['"]?\s*[:,]\s*(value:\s*)?['"]\*['"]/i);
    }
  });

  it('a rota /pdf não usa unsafe-inline', () => {
    const src = semComentarios(readFileSync(join(RAIZ, 'app/pdf/[id]/route.ts'), 'utf8'));
    expect(src).not.toContain('unsafe-inline');
    expect(src).toContain("'nonce-${nonce}'");
  });
});
