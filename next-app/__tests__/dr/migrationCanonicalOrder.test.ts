// __tests__/dr/migrationCanonicalOrder.test.ts — trava o achado HIGH-3 da
// auditoria de disaster recovery (2026-09-17): reaplicar as 101 migrations
// deste repo em ORDEM ALFABÉTICA DE NOME (o jeito ingênuo de reconstruir um
// projeto do zero) REGRIDE `get_feed_v2` e `is_portal_admin()` pra versões
// supersedidas, porque várias migrations no mesmo dia redefinem a MESMA
// função e a canônica não é sempre a última em ordem de arquivo.
//
// `migrations/MIGRATIONS.md` já documenta em PROSA quais arquivos são os
// canônicos — mas nada IMPEDIA alguém de acrescentar uma 6ª/3ª migration
// redefinindo essas funções sem atualizar aquele documento, e a próxima
// pessoa reconstruindo o banco do zero nunca saberia que a lista mudou.
//
// Este teste não substitui uma ferramenta de migration real (o próprio
// MIGRATIONS.md registra isso como "recomendação futura", fora do escopo
// desta correção pontual) — ele é uma rede de segurança: se uma migration
// nova redefinir `get_feed_v2`/`is_portal_admin()`, o teste FALHA até
// alguém atualizar conscientemente esta lista + `MIGRATIONS.md`, em vez de
// a regressão passar batido.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), '..', 'migrations');
const MIGRATIONS_DOC = join(MIGRATIONS_DIR, 'MIGRATIONS.md');

// Conjunto conhecido (2026-09-17) de arquivos que redefinem cada função.
// Mudou o conjunto? Atualizar aqui E em MIGRATIONS.md, na mesma revisão —
// nunca só um dos dois.
const KNOWN_GET_FEED_V2_FILES = [
  '2026-06-09-blocks.sql',
  '2026-06-09-boost-trending.sql',
  '2026-06-09-feed-verified-fix.sql',
  '2026-06-09-posts-media-dimensions.sql',
  '2026-06-09-rpc-get-feed-v2.sql',
  '2026-09-17-privacy-audit-hardening.sql',
].sort();

// Auditoria de privacidade (2026-09-17): trava p_limit em 50 e revoga o
// GRANT de anon — cumulativa sobre a definição de 2026-06-09.
const CANONICAL_GET_FEED_V2_FILE = '2026-09-17-privacy-audit-hardening.sql';

const KNOWN_IS_PORTAL_ADMIN_FILES = [
  '2026-06-05-is-portal-admin-permissive.sql',
  '2026-09-03-fix-quotes-policy-and-is-portal-admin.sql',
].sort();

const CANONICAL_IS_PORTAL_ADMIN_FILE =
  '2026-09-03-fix-quotes-policy-and-is-portal-admin.sql';

function filesDefiningFunction(fnName: string): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}\\b`,
    'i',
  );
  return files
    .filter((f) => re.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
    .sort();
}

describe('DR: ordem de replay de migrations não regride get_feed_v2/is_portal_admin em silêncio', () => {
  it('o conjunto de arquivos que redefinem get_feed_v2 não mudou sem atualizar este teste', () => {
    const found = filesDefiningFunction('get_feed_v2');
    expect(
      found,
      'novo arquivo redefine get_feed_v2 — atualizar KNOWN_GET_FEED_V2_FILES ' +
        'aqui e a seção "Ordem de aplicação" de migrations/MIGRATIONS.md ' +
        'na MESMA revisão, confirmando qual arquivo é o canônico agora',
    ).toEqual(KNOWN_GET_FEED_V2_FILES);
  });

  it('o conjunto de arquivos que redefinem is_portal_admin não mudou sem atualizar este teste', () => {
    const found = filesDefiningFunction('is_portal_admin');
    expect(
      found,
      'novo arquivo redefine is_portal_admin() — atualizar ' +
        'KNOWN_IS_PORTAL_ADMIN_FILES aqui e migrations/MIGRATIONS.md',
    ).toEqual(KNOWN_IS_PORTAL_ADMIN_FILES);
  });

  it('MIGRATIONS.md ainda documenta o arquivo canônico de get_feed_v2', () => {
    const doc = readFileSync(MIGRATIONS_DOC, 'utf8');
    expect(doc).toContain(CANONICAL_GET_FEED_V2_FILE);
  });

  it('MIGRATIONS.md ainda documenta o arquivo canônico de is_portal_admin', () => {
    const doc = readFileSync(MIGRATIONS_DOC, 'utf8');
    expect(doc).toContain(CANONICAL_IS_PORTAL_ADMIN_FILE);
  });

  it('o arquivo canônico de get_feed_v2 de fato define a função (não é só citado em prosa)', () => {
    const content = readFileSync(join(MIGRATIONS_DIR, CANONICAL_GET_FEED_V2_FILE), 'utf8');
    expect(content).toMatch(/create\s+or\s+replace\s+function\s+public\.get_feed_v2\b/i);
  });

  it('o arquivo canônico de is_portal_admin de fato define a função (não é só citado em prosa)', () => {
    const content = readFileSync(
      join(MIGRATIONS_DIR, CANONICAL_IS_PORTAL_ADMIN_FILE),
      'utf8',
    );
    expect(content).toMatch(/create\s+or\s+replace\s+function\s+public\.is_portal_admin\b/i);
  });
});
