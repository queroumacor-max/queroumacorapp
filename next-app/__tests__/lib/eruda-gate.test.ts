// eruda-gate.test.ts — o console Eruda (script de CDN dentro da casca) só
// entra com NEXT_PUBLIC_ERUDA=1 no build. Em produção ele dava a qualquer
// pessoa com o aparelho (e a qualquer comprometimento do CDN) um console
// com acesso à sessão no localStorage.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('app/layout.tsx — Eruda', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf-8');
  it('o script do Eruda está atrás de NEXT_PUBLIC_ERUDA === "1"', () => {
    const idx = src.indexOf('cdn.jsdelivr.net/npm/eruda');
    expect(idx).toBeGreaterThan(0);
    const antes = src.slice(Math.max(0, idx - 600), idx);
    expect(antes).toMatch(/process\.env\.NEXT_PUBLIC_ERUDA === '1'/);
  });
  it('a URL do Eruda tem versão fixada (não flutua com o CDN)', () => {
    expect(src).toMatch(/npm\/eruda@\d/);
  });
});
