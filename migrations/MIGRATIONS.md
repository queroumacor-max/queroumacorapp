# migrations/ — como funciona e cuidados

Não há ferramenta de migration ativa (nem CLI, nem `schema_migrations`). Cada
arquivo é um SQL **idempotente** rodado à mão no Supabase SQL Editor. O
estado do que já foi aplicado é rastreado em prosa no `CLAUDE.md` ("JÁ
EXECUTADO"). Este arquivo cobre os cuidados que a auditoria 2026-08-26
levantou.

## Regras ao criar um SQL novo

1. **Idempotente sempre**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
   EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`, `CREATE OR
   REPLACE FUNCTION`. Deve poder rodar 2×.
2. **Colar o SQL completo no chat** pro mantenedor rodar — criar só o arquivo
   não basta (o assistant não tem acesso ao banco).
3. **Colar pelo celular corta blocos grandes** (pegadinha 42601): preferir
   statements em linha única, e a aba do editor vazia.
4. **Conferir o schema REAL antes de INSERT/UPDATE** — a lista de colunas do
   código TypeScript não é a da tabela (já custou `leads.city`,
   `quotes.post_id`). Pra colunas de admin que podem não existir, usar o
   padrão `to_jsonb(p) ->> 'coluna'` (coluna ausente → NULL, não aborta).

## Ordem de aplicação

Os nomes são datados (`YYYY-MM-DD-descricao.sql`), mas **a data no nome não
garante ordem** entre arquivos do mesmo dia. Onde a ordem importa, o próprio
SQL tem guardas de idempotência. Cuidado registrado pela auditoria:

- **`get_feed_v2` foi recriada várias vezes** (Waves 16/17/21/22/23, todas em
  2026-06-09, mais duas vezes em 2026-09-17/18). A definição
  **canônica/vigente** é a de `2026-09-18-final-pentest-hardening.sql`
  (cumulativa: boost + blocks + verified + media dims + clamp de `p_limit`
  em 50 + REVOKE de `anon` + deriva o usuário chamador de `auth.uid()` em
  vez do `p_user_id` que o cliente manda). Ela reconcilia (2026-09-19) duas
  correções que nasceram em branches irmãs nunca integradas entre si — a
  de privacidade (`2026-09-17-privacy-audit-hardening.sql`, clamp +
  REVOKE) e a do pentest final (o fix do IDOR de `p_user_id`) — então **as
  duas migrations continuam precisando rodar**, mas quem fecha o
  comportamento final é sempre a do pentest, por rodar por último. Se
  rodar a pasta em ordem alfabética de nome, `posts-media-dimensions.sql`
  e `rpc-get-feed-v2.sql` (ambas de 2026-06-09) vêm depois de
  `feed-verified-fix.sql` e **regridem** a função — então, ao reaplicar do
  zero, rodar `privacy-audit-hardening.sql` e depois
  `final-pentest-hardening.sql` POR ÚLTIMO entre as de feed.
- **`is_portal_admin()`** teve 3 definições ao longo do tempo. A vigente é a
  de `2026-09-03-fix-quotes-policy-and-is-portal-admin.sql` (padrão
  `to_jsonb`, que tolera a coluna fantasma `is_admin`).

## Não são migrations (não rodar como schema)

- `2026-06-09-perf-indexes-check.sql` — só `EXPLAIN ANALYZE`, auditoria.
- `2026-06-17-{coral,sherwin}-colors-*.sql`, `2026-06-17-leque-reset-*.sql`,
  `2026-08-29-import-leads-planilha.sql` — imports de DADOS, não DDL.

## Recomendação futura

Migrar pra `supabase migration`/`db push` (histórico versionado + rollback),
ou no mínimo criar uma tabela `applied_migrations` populada à mão + um diff
periódico (`pg_dump --schema-only` do banco vs esta pasta) pra pegar drift.
