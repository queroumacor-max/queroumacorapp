// __tests__/dr/drIntegrityReport.test.ts — trava o achado HIGH-4 da
// auditoria de disaster recovery (2026-09-17): não existia NENHUMA
// checagem de reconciliação Storage↔DB na direção "DB referencia um
// arquivo que sumiu do bucket" — só a oposta (cleanup_orphan_media,
// Storage→DB) existia.
//
// A correção é `public.dr_integrity_report()`
// (migrations/2026-09-17-dr-deletion-tombstone-and-integrity.sql):
// função read-only, admin-gated, que serve tanto de checagem periódica
// quanto de validação pós-restore (não roda sozinha, é chamada pelo
// operador — ver docs/DR_RUNBOOK.md).

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

describe('DR: dr_integrity_report() — validação pós-restore/periódica', () => {
  it('a migration existe', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('a função é read-only (nenhum insert/update/delete/drop no corpo)', () => {
    const sql = readMigration();
    const fnMatch = sql.match(
      /create or replace function public\.dr_integrity_report\(\)[\s\S]*?\$\$;/i
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];

    expect(body).not.toMatch(/\binsert into\b/i);
    expect(body).not.toMatch(/\bupdate\s+\w+\s+set\b/i);
    expect(body).not.toMatch(/\bdelete from\b/i);
    expect(body).not.toMatch(/\bdrop\s+(table|function|policy)\b/i);
    expect(body).not.toMatch(/\btruncate\b/i);
  });

  it('é gateada por is_portal_admin() no início do corpo', () => {
    const sql = readMigration();
    const fnMatch = sql.match(
      /create or replace function public\.dr_integrity_report\(\)[\s\S]*?\$\$;/i
    );
    expect(fnMatch![0]).toMatch(/if not public\.is_portal_admin\(\) then/i);
  });

  it('cobre as checagens documentadas: RLS geral, posts/avatar vs storage.objects, hash duplicado, profile órfão, push token órfão', () => {
    const sql = readMigration();
    for (const checkName of [
      'rls_enabled_on_all_tables',
      'posts_media_url_missing_from_storage',
      'profiles_avatar_url_missing_from_storage',
      'media_hash_blocklist_no_duplicates',
      'profiles_without_auth_user',
      'push_device_tokens_orphaned',
    ]) {
      expect(sql).toContain(checkName);
    }
  });

  it('EXECUTE é restrito a authenticated (nunca anon/public)', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /revoke all on function public\.dr_integrity_report\(\) from public, anon, authenticated/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.dr_integrity_report\(\) to authenticated/i
    );
  });

  it('a checagem de storage.objects usa o bucket certo pra cada coluna (posts vs avatars)', () => {
    const sql = readMigration();
    // A checagem de posts.media_url tem que filtrar bucket_id='posts';
    // a de profiles.avatar_url tem que filtrar bucket_id='avatars'.
    // Confusão entre os dois faria o relatório reportar falso-positivo
    // pra sempre (todo avatar "ausente" porque procurado no bucket
    // errado).
    const postsCheckIdx = sql.indexOf('posts_media_url_missing_from_storage');
    const postsCheckBlock = sql.slice(Math.max(0, postsCheckIdx - 600), postsCheckIdx);
    expect(postsCheckBlock).toMatch(/bucket_id = 'posts'/);

    const avatarCheckIdx = sql.indexOf('profiles_avatar_url_missing_from_storage');
    const avatarCheckBlock = sql.slice(Math.max(0, avatarCheckIdx - 600), avatarCheckIdx);
    expect(avatarCheckBlock).toMatch(/bucket_id = 'avatars'/);
  });
});
