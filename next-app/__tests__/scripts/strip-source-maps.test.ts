// Auditoria de segurança Cloudflare (2026-09-13): sem `SENTRY_AUTH_TOKEN`
// no ambiente de build, o webpack plugin do @sentry/nextjs pula o upload
// de source maps — e, junto, pula o apagamento delas no artefato final.
// Resultado observado inspecionando `.vercel/output/static` de um build
// real: 157 arquivos `.js.map` publicamente baixáveis, reconstruindo o
// código-fonte legível do app inteiro.
//
// `scripts/strip-source-maps.mjs` é a defesa em profundidade: roda DEPOIS
// do `next-on-pages` e apaga todo `.map` do artefato, independente de o
// Sentry ter feito upload ou não (o upload, quando acontece, já rodou
// antes, durante o `next build`). Este teste prova o script contra um
// diretório de saída fake, sem precisar rodar o build inteiro.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'strip-source-maps.mjs');

function buildFakeOutput(): string {
  const root = mkdtempSync(join(tmpdir(), 'strip-maps-'));
  const staticDir = join(root, '.vercel', 'output', 'static');
  const chunks = join(staticDir, '_next', 'static', 'chunks');
  mkdirSync(chunks, { recursive: true });
  writeFileSync(join(chunks, 'main-abc123.js'), 'console.log(1);');
  writeFileSync(join(chunks, 'main-abc123.js.map'), '{"version":3}');
  writeFileSync(join(chunks, 'framework-def456.js.map'), '{"version":3}');
  mkdirSync(join(staticDir, '_worker.js'), { recursive: true });
  writeFileSync(join(staticDir, '_worker.js', 'index.js'), 'export default {};');
  writeFileSync(join(staticDir, 'robots.txt'), 'User-agent: *');
  return root;
}

describe('scripts/strip-source-maps.mjs', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('apaga todo .map do artefato e preserva os demais arquivos', () => {
    dir = buildFakeOutput();
    execFileSync('node', [SCRIPT], { cwd: dir });

    const staticDir = join(dir, '.vercel', 'output', 'static');
    expect(existsSync(join(staticDir, '_next', 'static', 'chunks', 'main-abc123.js.map'))).toBe(
      false
    );
    expect(
      existsSync(join(staticDir, '_next', 'static', 'chunks', 'framework-def456.js.map'))
    ).toBe(false);

    // Arquivos que não são .map continuam intactos.
    expect(existsSync(join(staticDir, '_next', 'static', 'chunks', 'main-abc123.js'))).toBe(true);
    expect(existsSync(join(staticDir, '_worker.js', 'index.js'))).toBe(true);
    expect(existsSync(join(staticDir, 'robots.txt'))).toBe(true);
  });

  it('não falha quando o diretório de output ainda não existe', () => {
    dir = mkdtempSync(join(tmpdir(), 'strip-maps-empty-'));
    expect(() => execFileSync('node', [SCRIPT], { cwd: dir })).not.toThrow();
  });
});
