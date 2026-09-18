// Auditoria de segurança Cloudflare (2026-09-13): sem `SENTRY_AUTH_TOKEN`
// no ambiente de build, o webpack plugin do @sentry/nextjs pula o upload
// de source maps — e, junto, pula o apagamento delas no artefato final.
// Resultado observado inspecionando o artefato de um build real: 157
// arquivos `.js.map` publicamente baixáveis, reconstruindo o código-fonte
// legível do app inteiro.
//
// `scripts/strip-source-maps.mjs` é a defesa em profundidade: roda DEPOIS
// do `opennextjs-cloudflare build` e apaga todo `.map` do artefato,
// independente de o Sentry ter feito upload ou não (o upload, quando
// acontece, já rodou antes, durante o `next build` que o `build:cf` roda
// por dentro). Migração pro adapter OpenNext: o artefato passou a ser
// `.open-next/worker.js` (arquivo) + `.open-next/assets/` (pasta) —
// IRMÃOS, não um dentro do outro — então o teste cobre .map em AMBOS, não
// só dentro de assets/ (achado do Codex na revisão da migração: um .map
// só dentro de worker.js passava batido antes). Este teste prova o script
// contra um diretório de saída fake, sem precisar rodar o build inteiro.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'strip-source-maps.mjs');

function buildFakeOutput(): string {
  const root = mkdtempSync(join(tmpdir(), 'strip-maps-'));
  const openNext = join(root, '.open-next');
  const chunks = join(openNext, 'assets', '_next', 'static', 'chunks');
  mkdirSync(chunks, { recursive: true });
  writeFileSync(join(chunks, 'main-abc123.js'), 'console.log(1);');
  writeFileSync(join(chunks, 'main-abc123.js.map'), '{"version":3}');
  writeFileSync(join(chunks, 'framework-def456.js.map'), '{"version":3}');
  // worker.js é IRMÃO de assets/, não filho — e pode ter seu próprio .map.
  writeFileSync(join(openNext, 'worker.js'), 'export default {};');
  writeFileSync(join(openNext, 'worker.js.map'), '{"version":3}');
  writeFileSync(join(openNext, 'assets', 'robots.txt'), 'User-agent: *');
  return root;
}

describe('scripts/strip-source-maps.mjs', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('apaga todo .map do artefato (assets/ e worker.js irmão) e preserva os demais arquivos', () => {
    dir = buildFakeOutput();
    execFileSync('node', [SCRIPT], { cwd: dir });

    const openNext = join(dir, '.open-next');
    expect(
      existsSync(join(openNext, 'assets', '_next', 'static', 'chunks', 'main-abc123.js.map'))
    ).toBe(false);
    expect(
      existsSync(join(openNext, 'assets', '_next', 'static', 'chunks', 'framework-def456.js.map'))
    ).toBe(false);
    expect(existsSync(join(openNext, 'worker.js.map'))).toBe(false);

    // Arquivos que não são .map continuam intactos.
    expect(existsSync(join(openNext, 'assets', '_next', 'static', 'chunks', 'main-abc123.js'))).toBe(
      true
    );
    expect(existsSync(join(openNext, 'worker.js'))).toBe(true);
    expect(existsSync(join(openNext, 'assets', 'robots.txt'))).toBe(true);
  });

  it('não falha quando o diretório de output ainda não existe', () => {
    dir = mkdtempSync(join(tmpdir(), 'strip-maps-empty-'));
    expect(() => execFileSync('node', [SCRIPT], { cwd: dir })).not.toThrow();
  });
});
