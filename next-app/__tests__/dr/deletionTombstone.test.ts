// __tests__/dr/deletionTombstone.test.ts — trava o achado HIGH-1 da
// auditoria de disaster recovery (2026-09-17): "restore antigo
// ressuscita conta deletada, sem nenhum registro que sobreviva pra
// reconciliar depois."
//
// A correção é a tabela `deletion_tombstones`
// (migrations/2026-09-17-dr-deletion-tombstone-and-integrity.sql):
// ledger append-only (sem policy de UPDATE/DELETE pra ninguém logado)
// que `admin_delete_user` passa a alimentar antes do delete de verdade.
//
// Este teste não substitui rodar a migration no banco — não há acesso
// a Postgres real deste ambiente. Ele garante que a correção em
// código não desaparece/regride em silêncio: se alguém apagar o
// arquivo, remover a tabela, ou soltar uma policy de UPDATE/DELETE
// nela, o teste denuncia.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  '..',
  'migrations',
  '2026-09-17-dr-deletion-tombstone-and-integrity.sql'
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('DR: deletion_tombstones (ledger imutável de exclusões)', () => {
  it('a migration existe', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('cria a tabela deletion_tombstones com RLS habilitada', () => {
    const sql = readMigration();
    expect(sql).toMatch(/create table if not exists public\.deletion_tombstones/i);
    expect(sql).toMatch(
      /alter table public\.deletion_tombstones enable row level security/i
    );
  });

  it('NÃO tem nenhuma policy de UPDATE ou DELETE (append-only de verdade)', () => {
    const sql = readMigration();
    // Isola o bloco da tabela (do CREATE TABLE até a próxima seção "──").
    const start = sql.indexOf('create table if not exists public.deletion_tombstones');
    const nextSection = sql.indexOf('── PARTE 1b', start);
    const block = sql.slice(start, nextSection === -1 ? sql.length : nextSection);

    expect(block).not.toMatch(/create policy[\s\S]*?for update/i);
    expect(block).not.toMatch(/create policy[\s\S]*?for delete/i);
    // A única policy esperada é SELECT pra admin.
    const policyMatches = block.match(/create policy/gi) ?? [];
    expect(policyMatches.length).toBe(1);
    expect(block).toMatch(/create policy deletion_tombstones_admin_select[\s\S]*?for select/i);
  });

  it('a policy de SELECT exige is_portal_admin()', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /create policy deletion_tombstones_admin_select[\s\S]{0,200}?is_portal_admin\(\)/i
    );
  });

  it('admin_delete_user grava na tombstone ANTES do delete em auth.users', () => {
    const sql = readMigration();
    const fnMatch = sql.match(
      /create or replace function public\.admin_delete_user[\s\S]*?\$\$;/i
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    const tombstoneIdx = fnBody.search(/insert into public\.deletion_tombstones/i);
    const deleteAuthIdx = fnBody.search(/delete from auth\.users/i);
    expect(tombstoneIdx).toBeGreaterThan(-1);
    expect(deleteAuthIdx).toBeGreaterThan(-1);
    expect(tombstoneIdx).toBeLessThan(deleteAuthIdx);
  });

  it('admin_delete_user continua exigindo is_portal_admin() e bloqueando auto-exclusão', () => {
    const sql = readMigration();
    expect(sql).toMatch(/if not public\.is_portal_admin\(\) then/i);
    expect(sql).toMatch(/if p_user_id = v_caller then/i);
  });

  it('EXECUTE de admin_delete_user é revogado de public/anon e concedido só a authenticated', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /revoke all on function public\.admin_delete_user\(uuid, boolean\) from public, anon/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.admin_delete_user\(uuid, boolean\) to authenticated/i
    );
  });
});
