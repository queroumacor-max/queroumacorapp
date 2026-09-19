// __tests__/dr/backupScriptSafety.test.ts — trava o achado HIGH-5 da
// auditoria de disaster recovery (2026-09-17): não existia NENHUM script
// de dump lógico independente do PITR gerenciado do Supabase. O script
// `scripts/dr/pg-logical-backup.sh` fecha esse gap; este teste garante
// que ele mantém as propriedades de segurança exigidas pelo item "15.
// BACKUP SCRIPT SECURITY" do audit (sem secret em log, output protegido,
// erro tratado, checksum) — lendo o ARQUIVO real, não uma cópia, e
// exercitando o script de verdade contra uma falha esperada (sem rodar
// nada contra um banco real).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT_PATH = join(process.cwd(), '..', 'scripts', 'dr', 'pg-logical-backup.sh');

function readScript(): string {
  return readFileSync(SCRIPT_PATH, 'utf8');
}

describe('DR: scripts/dr/pg-logical-backup.sh — propriedades de segurança', () => {
  it('o script existe e é executável', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
    const mode = statSync(SCRIPT_PATH).mode;
    // dono precisa ter bit de execução (0o100).
    expect(mode & 0o100).toBeTruthy();
  });

  it('roda sob set -euo pipefail (aborta em qualquer falha no meio)', () => {
    const sh = readScript();
    expect(sh).toMatch(/^set -euo pipefail$/m);
  });

  it('nunca ecoa a connection string inteira (nunca `echo`, só `printf` redirecionado pra extrair o host)', () => {
    const sh = readScript();
    // `echo` nunca deve carregar a variável — a única leitura permitida é o
    // `printf '%s' "$SUPABASE_DB_URL" | sed ...` que extrai só o host.
    expect(sh).not.toMatch(/\becho\b[^\n]*\$SUPABASE_DB_URL/);
    // O único `printf` com a variável tem que estar num pipe pro `sed`
    // (extração de host), nunca solto imprimindo a URL crua.
    const printfLines = sh
      .split('\n')
      .filter((line) => /\bprintf\b[^\n]*\$SUPABASE_DB_URL/.test(line));
    expect(printfLines.length).toBeGreaterThan(0);
    for (const line of printfLines) {
      expect(line).toMatch(/\|\s*sed\b/);
    }
    // O redirecionamento de erro do pg_dump precisa redigir credencial
    // (regra: qualquer stderr que ecoe a URL tem que mascarar a senha).
    expect(sh).toMatch(/REDACTED/);
  });

  it('protege o arquivo de saída (chmod 600) e o diretório (chmod 700)', () => {
    const sh = readScript();
    expect(sh).toMatch(/chmod 700/);
    expect(sh).toMatch(/chmod 600/);
  });

  it('gera checksum (sha256) do dump', () => {
    const sh = readScript();
    expect(sh).toMatch(/sha256sum|shasum -a 256/);
  });

  it('remove o arquivo de saída se o pg_dump falhar (nunca deixa dump parcial passando por completo)', () => {
    const sh = readScript();
    expect(sh).toMatch(/pg_dump falhou/);
    expect(sh).toMatch(/rm -f "\$OUT_FILE"/);
  });

  it('default é --schema-only; dado real só sai com --with-data explícito', () => {
    const sh = readScript();
    expect(sh).toMatch(/--schema-only/);
    expect(sh).toMatch(/--with-data/);
  });

  it('não sobe o resultado pra lugar nenhum (nenhum aws/gsutil/curl -T/scp de upload)', () => {
    const sh = readScript();
    expect(sh).not.toMatch(/aws s3|gsutil cp|scp |curl -T|rclone/);
  });

  it('falha limpo (exit 2, sem tentar rodar pg_dump) quando SUPABASE_DB_URL está ausente', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-backup-test-'));
    try {
      let exitCode = 0;
      let stderr = '';
      const { SUPABASE_DB_URL: _unused, ...envWithoutDbUrl } = process.env;
      void _unused;
      try {
        execFileSync('bash', [SCRIPT_PATH, tmp], {
          env: envWithoutDbUrl,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        const err = e as { status?: number; stderr?: Buffer };
        exitCode = err.status ?? -1;
        stderr = err.stderr?.toString('utf8') ?? '';
      }
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/SUPABASE_DB_URL/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
