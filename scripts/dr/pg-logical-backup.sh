#!/usr/bin/env bash
# scripts/dr/pg-logical-backup.sh — dump lógico independente do PITR
# gerenciado do Supabase (auditoria de DR 2026-09-17, achado HIGH-5:
# "DR depende 100% do PITR gerenciado do Supabase — nenhum código deste
# repo tira uma cópia lógica alternativa").
#
# ISTO NÃO RODA SOZINHO — não há cron, não há GitHub Actions chamando
# este arquivo, e ele não deve ganhar um sem decisão explícita do
# usuário (colocar a service_role key ou a connection string do banco
# num secret de CI amplia a superfície de um GITHUB_TOKEN/Actions
# comprometido conseguir ler produção — ver DR_AUDIT_2026-09-17.md
# §Secret Recovery Matrix). Uso: rodar À MÃO, localmente, quando quiser
# uma cópia offline pra complementar o PITR do Supabase.
#
# Uso:
#   SUPABASE_DB_URL='postgresql://postgres:<senha>@<host>:5432/postgres' \
#     scripts/dr/pg-logical-backup.sh [diretorio_de_saida]
#
# Requisitos: `pg_dump` (>=15) instalado localmente. O Supabase Dashboard
# → Project Settings → Database → Connection string tem a URL pronta
# (escolher "URI", modo "Session" — pooler transaction mode não suporta
# todas as extensões que `pg_dump --schema-only` pode precisar listar).
#
# Segurança:
#   - A connection string NUNCA é logada (nem em erro) — só o host é
#     impresso, extraído sem a senha, pra confirmar contra qual banco
#     rodou sem vazar credencial em terminal/CI log.
#   - Saída vai pra um arquivo com permissão 600 (só o dono lê).
#   - SHA-256 do arquivo é gravado ao lado, pra checagem de integridade
#     antes de um restore.
#   - `set -euo pipefail`: qualquer falha no meio (conexão caiu,
#     pg_dump não encontrado, disco cheio) aborta com exit != 0 — nunca
#     um dump parcial se passando por completo.
#   - Por padrão faz `--schema-only` (schema completo, zero dado de
#     usuário) — decisão deliberada: um dump COM dados de produção é
#     mais sensível que a própria produção (LGPD, PII, mensagens de
#     WhatsApp, leads) e não deve ficar num laptop/disco externo sem
#     essa escolha ser consciente. Pra incluir dados, passar
#     `--with-data` explicitamente (ver abaixo) — a pessoa que roda
#     decide, o script não assume.
#
# O QUE ISTO NÃO FAZ:
#   - Não sobe o resultado pra lugar nenhum (S3, GitHub, etc.) — colar
#     um dump em qualquer lugar público seria o achado CRÍTICO "218.
#     PUBLIC BACKUP" da auditoria. Guardar o arquivo resultante é
#     responsabilidade de quem roda (cofre de credenciais, disco
#     criptografado — nunca o repositório).
#   - Não restaura nada. Ver docs/DR_RUNBOOK.md pro procedimento de
#     restore (e por que não fazer isso sem autorização/plano).

set -euo pipefail

WITH_DATA=0
OUT_DIR=""
for arg in "$@"; do
  if [ "$arg" = "--with-data" ]; then
    WITH_DATA=1
  else
    OUT_DIR="$arg"
  fi
done
OUT_DIR="${OUT_DIR:-./dr-backups}"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "erro: defina SUPABASE_DB_URL (connection string do Supabase, modo Session)." >&2
  echo "  Dashboard -> Project Settings -> Database -> Connection string -> URI." >&2
  exit 2
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "erro: pg_dump não encontrado no PATH. Instale postgresql-client (>=15)." >&2
  exit 2
fi

# Extrai só o host da connection string pra log seguro (nunca a senha).
DB_HOST="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's#^[a-zA-Z0-9+]+://[^@]*@([^:/]+).*#\1#')"
if [ "$DB_HOST" = "$SUPABASE_DB_URL" ]; then
  DB_HOST="(host não identificável na URL — confira o formato)"
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MODE="schema-only"
DUMP_ARGS=(--no-owner --no-privileges --format=custom)
if [ "$WITH_DATA" -eq 1 ]; then
  MODE="schema-and-data"
else
  DUMP_ARGS+=(--schema-only)
fi

OUT_FILE="$OUT_DIR/queroumacor-${MODE}-${TIMESTAMP}.dump"

echo "Rodando pg_dump ($MODE) contra host: $DB_HOST"
echo "Saída: $OUT_FILE"

# A connection string vai só pro pg_dump (via env padrão do libpq,
# PGCONNSTRING não existe — usamos o argumento posicional, que o
# próprio pg_dump não ecoa de volta em stdout/stderr em uso normal).
if ! pg_dump "$SUPABASE_DB_URL" "${DUMP_ARGS[@]}" --file="$OUT_FILE" 2> >(sed -E 's#(postgresql://[^:]+:)[^@]+(@)#\1[REDACTED]\2#' >&2); then
  echo "erro: pg_dump falhou — dump pode estar incompleto/ausente. Não confiar em $OUT_FILE." >&2
  rm -f "$OUT_FILE"
  exit 1
fi

chmod 600 "$OUT_FILE"

CHECKSUM_FILE="${OUT_FILE}.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$OUT_FILE" > "$CHECKSUM_FILE"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$OUT_FILE" > "$CHECKSUM_FILE"
else
  echo "aviso: nenhum sha256sum/shasum encontrado — checksum não gerado." >&2
fi
[ -f "$CHECKSUM_FILE" ] && chmod 600 "$CHECKSUM_FILE"

echo "OK: dump concluído e verificável em $CHECKSUM_FILE"
echo "Lembrete: NÃO commitar este arquivo, NÃO subir pra bucket/serviço público."
echo "Guardar em local criptografado, fora do repositório (ver docs/DR_RUNBOOK.md)."
