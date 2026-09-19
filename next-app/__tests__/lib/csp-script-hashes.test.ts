// PENTEST (2026-09-19): `script-src` da CSP (middleware.ts) removeu
// `'unsafe-inline'` e passou a confiar nos scripts inline do próprio app
// por HASH (sha256 do conteúdo exato) em vez de nonce por request — ver o
// comentário grande em cima de `SECURITY_CSP` em `middleware.ts` pro
// raciocínio completo (por que hash e não nonce, e por que #298 foi
// fechada sem merge).
//
// Este teste recalcula os 8 hashes a partir do FONTE real (não confia em
// nenhum valor copiado) e falha se algum não aparecer em `middleware.ts`
// — ou seja, se alguém editar um desses scripts (mesmo um espaço) sem
// atualizar o hash na CSP, o script para de rodar em produção, e essa
// falha é SILENCIOSA pro usuário (o navegador só bloqueia, sem quebrar a
// página) — daí a importância de travar isso em CI.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function sha256b64(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('base64');
}

function cspFromMiddleware(): string {
  const raw = readFileSync('middleware.ts', 'utf8');
  const m = raw.match(/const SECURITY_CSP =\s*\n?\s*"([^"]*)"/);
  if (!m) throw new Error('middleware.ts sem `const SECURITY_CSP = "..."` no formato esperado');
  return m[1];
}

function layoutInlineScripts(): string[] {
  const raw = readFileSync('app/layout.tsx', 'utf8');
  const re = /dangerouslySetInnerHTML=\{\{\s*__html:\s*`([\s\S]*?)`,?\s*\}\}/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1]);
  return out;
}

function telaReconectandoRetry(): string {
  const raw = readFileSync('components/TelaReconectando.tsx', 'utf8');
  const m = raw.match(/const RETRY = `([\s\S]*?)`;/);
  if (!m) throw new Error('TelaReconectando.tsx: RETRY não encontrado no formato esperado');
  return m[1];
}

function portalInlineScripts(): string[] {
  const raw = readFileSync('public/portal/index.html', 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1]);
  return out;
}

describe('CSP script-src: hashes batem com o conteúdo real dos scripts inline', () => {
  const csp = cspFromMiddleware();

  it('script-src NÃO tem mais unsafe-inline', () => {
    const scriptSrc = csp.split(';').find((s) => s.trim().startsWith('script-src'));
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('app/layout.tsx: os 4 scripts inline (tema, fuso, scroll-pin, eruda) têm hash na CSP', () => {
    const scripts = layoutInlineScripts();
    expect(scripts.length).toBe(4);
    for (const s of scripts) {
      expect(csp).toContain(`'sha256-${sha256b64(s)}'`);
    }
  });

  it('components/TelaReconectando.tsx: o script de auto-retry tem hash na CSP', () => {
    const retry = telaReconectandoRetry();
    expect(csp).toContain(`'sha256-${sha256b64(retry)}'`);
  });

  it('public/portal/index.html: os 3 scripts inline (Sentry, fuso, config) têm hash na CSP', () => {
    const scripts = portalInlineScripts();
    expect(scripts.length).toBe(3);
    for (const s of scripts) {
      expect(csp).toContain(`'sha256-${sha256b64(s)}'`);
    }
  });
});
