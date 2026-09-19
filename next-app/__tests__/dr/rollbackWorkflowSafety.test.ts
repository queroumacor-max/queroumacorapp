// __tests__/dr/rollbackWorkflowSafety.test.ts — trava os achados
// MEDIUM-1 (mensagem incorreta sobre o mecanismo de deploy) e
// reconfirma as proteções já auditadas em 2026-09-16 (argument
// injection, confirmação obrigatória) na auditoria de disaster
// recovery de 2026-09-17, lendo o arquivo REAL do workflow — não uma
// cópia — pra denunciar regressão se alguém reintroduzir a mensagem
// enganosa ou remover uma guarda.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROLLBACK_PATH = join(process.cwd(), '..', '.github', 'workflows', 'rollback.yml');
const DEPLOY_PATH = join(process.cwd(), '..', '.github', 'workflows', 'deploy.yml');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('DR: rollback.yml não afirma coisa incorreta sobre o mecanismo de deploy', () => {
  it('NÃO contém mais a afirmação falsa "deploy.yml vai rodar automaticamente"', () => {
    const yml = read(ROLLBACK_PATH);
    expect(yml).not.toMatch(/deploy\.yml vai rodar automaticamente/i);
  });

  it('explica que o Cloudflare Pages Git integration é quem redeploya', () => {
    const yml = read(ROLLBACK_PATH);
    expect(yml.toLowerCase()).toMatch(/cloudflare pages/);
  });

  it('mantém a confirmação literal ROLLBACK obrigatória', () => {
    const yml = read(ROLLBACK_PATH);
    expect(yml).toMatch(/CONFIRM_INPUT.*!=.*"ROLLBACK"/s);
  });

  it('mantém a recusa de target_sha começando com "-" (argument injection)', () => {
    const yml = read(ROLLBACK_PATH);
    expect(yml).toMatch(/case "\$target" in/);
    expect(yml).toMatch(/-\*\)/);
  });

  it('passa os inputs via env, nunca interpolados direto no run:', () => {
    const yml = read(ROLLBACK_PATH);
    // Não deve existir `${{ github.event.inputs.` fora de um bloco `env:`.
    const lines = yml.split('\n');
    for (const line of lines) {
      if (line.includes('${{ github.event.inputs.')) {
        expect(line).not.toMatch(/^\s*run:/);
      }
    }
  });

  it('é workflow_dispatch-only (nunca dispara em push)', () => {
    const yml = read(ROLLBACK_PATH);
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).not.toMatch(/^\s*push:/m);
  });
});

describe('DR: deploy.yml é dispatch-only e gated a main (consistência com o rollback)', () => {
  it('é workflow_dispatch (não dispara em push)', () => {
    const yml = read(DEPLOY_PATH);
    expect(yml).toMatch(/workflow_dispatch/);
  });

  it('gateia execução real a refs/heads/main', () => {
    const yml = read(DEPLOY_PATH);
    expect(yml).toMatch(/refs\/heads\/main/);
  });

  it('usa npm ci, não npm install', () => {
    const yml = read(DEPLOY_PATH);
    expect(yml).toMatch(/npm ci/);
  });
});
