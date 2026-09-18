// Auditoria de segurança Cloudflare (2026-09-13): sem `SENTRY_AUTH_TOKEN`
// no ambiente de build, o @sentry/nextjs pode pular o upload de source
// maps — e, se pular, pode também pular o apagamento delas no artefato
// final. Resultado observado inspecionando o artefato real de um build:
// arquivos `.js.map` publicamente baixáveis, reconstruindo o código-fonte
// legível do app inteiro.
//
// `scripts/strip-source-maps.mjs` é a defesa em profundidade: roda DEPOIS
// do build do adapter Cloudflare e apaga todo `.map` do artefato,
// independente de o Sentry ter feito upload ou não.
//
// Migração @cloudflare/next-on-pages → @opennextjs/cloudflare (2026-09-18):
// o artefato saiu de `.vercel/output/static` pra `.open-next/assets`.
// Rodar o script (antes desta migração) sem atualizar o path fazia ele
// reportar "0 arquivo(s) .map removido(s)" **em silêncio, sem erro** —
// olhando pra um diretório que nem existia mais. Por isso o script agora
// FALHA (exit não-zero) quando o diretório de saída não existe, em vez de
// reportar sucesso silencioso — e o teste que antes provava o
// comportamento OPOSTO ("não falha quando o diretório ainda não existe")
// foi invertido de propósito: essa era exatamente a lacuna que permitia a
// falha silenciosa passar despercebida.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'strip-source-maps.mjs');

function buildFakeOutput(): string {
  const root = mkdtempSync(join(tmpdir(), 'strip-maps-'));
  const assetsDir = join(root, '.open-next', 'assets');
  const chunks = join(assetsDir, '_next', 'static', 'chunks');
  mkdirSync(chunks, { recursive: true });
  writeFileSync(join(chunks, 'main-abc123.js'), 'console.log(1);');
  writeFileSync(join(chunks, 'main-abc123.js.map'), '{"version":3}');
  writeFileSync(join(chunks, 'framework-def456.js.map'), '{"version":3}');
  mkdirSync(join(assetsDir, '_worker.js'), { recursive: true });
  writeFileSync(join(assetsDir, '_worker.js', 'index.js'), 'export default {};');
  writeFileSync(join(assetsDir, 'robots.txt'), 'User-agent: *');
  return root;
}

describe('scripts/strip-source-maps.mjs', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('apaga todo .map do artefato (.open-next/assets) e preserva os demais arquivos', () => {
    dir = buildFakeOutput();
    execFileSync('node', [SCRIPT], { cwd: dir });

    const assetsDir = join(dir, '.open-next', 'assets');
    expect(existsSync(join(assetsDir, '_next', 'static', 'chunks', 'main-abc123.js.map'))).toBe(
      false
    );
    expect(
      existsSync(join(assetsDir, '_next', 'static', 'chunks', 'framework-def456.js.map'))
    ).toBe(false);

    // Arquivos que não são .map continuam intactos.
    expect(existsSync(join(assetsDir, '_next', 'static', 'chunks', 'main-abc123.js'))).toBe(true);
    expect(existsSync(join(assetsDir, '_worker.js', 'index.js'))).toBe(true);
    expect(existsSync(join(assetsDir, 'robots.txt'))).toBe(true);
  });

  it('FALHA (não reporta sucesso silencioso) quando o diretório de output não existe', () => {
    dir = mkdtempSync(join(tmpdir(), 'strip-maps-empty-'));
    let threw = false;
    let stderr = '';
    try {
      execFileSync('node', [SCRIPT], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      threw = true;
      stderr = String((e as { stderr?: Buffer }).stderr ?? '');
    }
    expect(threw).toBe(true);
    expect(stderr).toMatch(/diretório de saída não existe/);
  });
});
