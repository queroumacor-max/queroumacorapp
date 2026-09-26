// Auditoria "19 pontos" (2026-09-26): o portal (JSX sem módulos) punha
// `brand_logos.image_url` — gravável pelo pintor via REST — direto num
// <a href>. `javascript:` ali = XSS com sessão de admin. Este teste trava:
// (1) a regra de `urlSegura`, (2) que nenhum href do portal volta a ler
// campo do banco cru, (3) a trava de clique duplo do "Criar Produto",
// (4) o `_headers` do binding ASSETS que protege o /portal de iframe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const jsx = readFileSync('public/portal/app.jsx', 'utf8');

function extrairUrlSegura(): (u: unknown) => string | null {
  const m = jsx.match(/const urlSegura = (\(u\) => [^\n]+);/);
  if (!m) throw new Error('app.jsx sem `const urlSegura = (u) => ...;`');
  return new Function('return ' + m[1])();
}

describe('portal: urlSegura', () => {
  const urlSegura = extrairUrlSegura();
  it('aceita só https', () => {
    expect(urlSegura('https://x.supabase.co/a.png')).toBe('https://x.supabase.co/a.png');
    expect(urlSegura('HTTPS://x.com/a')).toBe('HTTPS://x.com/a');
    expect(urlSegura('  https://x.com/a ')).toBe('https://x.com/a');
  });
  it('recusa javascript:, data:, http:, relativo e não-string', () => {
    for (const u of ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'http://x.com', '//x.com', '/a', '', null, undefined, 42]) {
      expect(urlSegura(u)).toBeNull();
    }
  });
});

describe('portal: nenhum href lê dado do banco cru', () => {
  it('todo href={...} é constante (wa.me/instagram) ou passa por urlSegura', () => {
    const hrefs = [...jsx.matchAll(/href=\{([^}]*)\}/g)].map((m) => m[1].trim());
    expect(hrefs.length).toBeGreaterThan(0);
    const ok = (h: string) =>
      /^urlSegura\(/.test(h) || /^'https:\/\/wa\.me\/'/.test(h) || /^urlDoIg\(/.test(h);
    expect(hrefs.filter((h) => !ok(h))).toEqual([]);
  });
});

describe('portal: "Criar Produto" não grava duas vezes', () => {
  it('saveProduct sai cedo quando já está salvando e libera no finally', () => {
    const i = jsx.indexOf('const saveProduct = async () => {');
    const corpo = jsx.slice(i, jsx.indexOf('\n  };', i));
    expect(corpo).toMatch(/if\(salvandoRef\.current\) return;/);
    expect(corpo).toMatch(/finally \{ salvandoRef\.current = false; setSalvando\(false\); \}/);
    expect(jsx).toMatch(/onClick=\{saveProduct\} disabled=\{salvando\}/);
  });
  it('o app.js compilado carrega as mesmas correções', () => {
    const js = readFileSync('public/portal/app.js', 'utf8');
    expect(js).toContain('const urlSegura = u =>');
    expect(js).toContain('salvandoRef.current');
  });
});

describe('public/_headers: /portal protegido no binding ASSETS', () => {
  const raw = readFileSync('public/_headers', 'utf8');
  function bloco(rota: string): string {
    const linhas = raw.split('\n');
    const i = linhas.findIndex((l) => l.trim() === rota);
    if (i < 0) throw new Error(`_headers sem regra ${rota}`);
    const out: string[] = [];
    for (let j = i + 1; j < linhas.length && /^\s+\S/.test(linhas[j]); j++) out.push(linhas[j].trim());
    return out.join('\n');
  }
  for (const rota of ['/portal', '/portal/*']) {
    it(`${rota} tem X-Frame-Options, frame-ancestors, nosniff e Referrer-Policy`, () => {
      const b = bloco(rota);
      expect(b).toContain('X-Frame-Options: DENY');
      expect(b).toMatch(/Content-Security-Policy: .*frame-ancestors 'none'/);
      expect(b).toContain("object-src 'none'");
      expect(b).toContain('X-Content-Type-Options: nosniff');
      expect(b).toContain('Referrer-Policy: strict-origin-when-cross-origin');
      // script-src próprio do portal: conferido em portalCsp.test.ts.
      expect(b).toContain('script-src');
    });
  }
});
