// Trava a ordem do deploy.yml: o artefato vai pro preview, o smoke test
// (Playwright) roda contra ele, e SÓ DEPOIS o passo de produção. A linha
// 16.4 do Next derrubou o app duas vezes com CI/tsc/vitest/`next build`
// verdes; esse portão é o que pega esse tipo de quebra antes do aparelho.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(process.cwd(), '..');
const DEPLOY = readFileSync(join(RAIZ, '.github', 'workflows', 'deploy.yml'), 'utf8');

describe('deploy.yml: produção só depois do smoke no preview', () => {
  it('publica no preview, roda o smoke e só então produção', () => {
    const preview = DEPLOY.indexOf('command: deploy --env preview');
    const smoke = DEPLOY.indexOf('node preview-smoke.mjs');
    const prod = DEPLOY.indexOf('command: deploy --env production');
    expect(preview).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(preview);
    expect(prod).toBeGreaterThan(smoke);
  });

  it('o passo do smoke não é pulável (sem continue-on-error nem if)', () => {
    const passo = DEPLOY.slice(
      DEPLOY.indexOf('- name: Smoke test do preview'),
      DEPLOY.indexOf('node preview-smoke.mjs'),
    );
    expect(passo).not.toMatch(/continue-on-error/);
    expect(passo).not.toMatch(/^\s+if:/m);
  });

  it('o script do smoke existe e falha o processo quando uma tela não abre', () => {
    const caminho = join(RAIZ, 'scripts', 'preview-smoke.mjs');
    expect(existsSync(caminho)).toBe(true);
    const src = readFileSync(caminho, 'utf8');
    expect(src).toMatch(/process\.exit\(falhou \? 1 : 0\)/);
    expect(src).toMatch(/\['\/feed', '\/login'\]/);
  });
});
