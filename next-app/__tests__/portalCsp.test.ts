// CSP do /portal (public/_headers, binding ASSETS). O script-src autoriza os
// <script> INLINE do portal por sha256: mexer num deles sem refazer o hash faz
// o navegador bloquear o script em silêncio e o portal quebra. Este teste
// recalcula os hashes do index.html real e exige que batam com o header.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const headers = readFileSync('public/_headers', 'utf8');
const html = readFileSync('public/portal/index.html', 'utf8');

function cspDa(rota: string): string {
  const linhas = headers.split('\n');
  const i = linhas.findIndex((l) => l.trim() === rota);
  if (i < 0) throw new Error(`_headers sem regra ${rota}`);
  for (let j = i + 1; j < linhas.length && /^\s+\S/.test(linhas[j]); j++) {
    const m = linhas[j].trim().match(/^Content-Security-Policy:\s*(.+)$/);
    if (m) return m[1];
  }
  throw new Error(`${rota} sem Content-Security-Policy`);
}

function diretiva(csp: string, nome: string): string[] {
  const d = csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(nome + ' '));
  return d ? d.split(/\s+/).slice(1) : [];
}

const inlines = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashes = inlines.map((c) => `'sha256-${createHash('sha256').update(c, 'utf8').digest('base64')}'`);

describe('CSP do /portal', () => {
  it('o index.html ainda tem os scripts inline esperados', () => {
    expect(inlines.length).toBeGreaterThan(0);
  });

  for (const rota of ['/portal', '/portal/*']) {
    const csp = cspDa(rota);
    const script = diretiva(csp, 'script-src');

    it(`${rota}: todo <script> inline do index.html tem o sha256 no script-src`, () => {
      for (const h of hashes) expect(script).toContain(h);
    });

    it(`${rota}: nenhum hash sobrando (script inline apagado = hash morto)`, () => {
      const noHeader = script.filter((s) => s.startsWith("'sha256-"));
      expect(noHeader.sort()).toEqual([...hashes].sort());
    });

    it(`${rota}: sem 'unsafe-inline'/'unsafe-eval' em script-src e sem host curinga`, () => {
      expect(script).not.toContain("'unsafe-inline'");
      expect(script).not.toContain("'unsafe-eval'");
      expect(script).not.toContain('https:');
      expect(script).not.toContain('*');
    });

    it(`${rota}: todo <script src> externo do index.html está liberado`, () => {
      const externos = [...html.matchAll(/<script[^>]*\ssrc="(https:\/\/[^"/]+)/g)].map((m) => m[1]);
      for (const origem of externos) expect(script).toContain(origem);
    });

    it(`${rota}: mantém quadro/plugin/base travados e libera Supabase`, () => {
      expect(diretiva(csp, 'frame-ancestors')).toEqual(["'none'"]);
      expect(diretiva(csp, 'object-src')).toEqual(["'none'"]);
      expect(diretiva(csp, 'base-uri')).toEqual(["'self'"]);
      expect(diretiva(csp, 'connect-src')).toContain('https://*.supabase.co');
      expect(diretiva(csp, 'connect-src')).toContain('wss://*.supabase.co');
    });
  }
});
