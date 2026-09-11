#!/usr/bin/env bash
# scripts/secret-scan-selftest.sh — prova que o scanner de segredos AINDA
# detecta o tipo de chave que já vazou neste repo (Google API key, `AIza…`).
#
# Auditoria 2026-09-11: a chave Gemini real do histórico foi pega pela regra
# padrão `gcp-api-key` do gitleaks (entropia >= 3). Um scanner que passa em
# silêncio não prova nada — este script cria DOIS diretórios temporários fora
# do repo e exige:
#   1. diretório com chave SINTÉTICA  -> gitleaks sai com 1 (detectou);
#   2. diretório limpo                -> gitleaks sai com 0 (passou).
# Qualquer outro resultado derruba o CI. A chave abaixo é inventada (39 chars,
# formato de Google API key, entropia alta) — não é credencial de ninguém.
#
# Uso: scripts/secret-scan-selftest.sh [caminho/do/gitleaks]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITLEAKS="${1:-gitleaks}"
CONFIG="$ROOT/.gitleaks.toml"

# Chave sintética representativa: prefixo real (AIzaSy), 33 chars aleatórios
# fixos pra o teste ser determinístico. NUNCA colocar aqui uma chave real.
FAKE_GOOGLE_KEY='AIzaSyD9xQ2mK7vLp4nR8tW3cY6hB1jF5gA0eZu'

if [ "${#FAKE_GOOGLE_KEY}" -ne 39 ]; then
  echo "selftest: chave sintética com tamanho errado (${#FAKE_GOOGLE_KEY}, esperado 39)" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/dirty" "$TMP/clean"
printf 'const GEMINI_API_KEY = "%s";\n' "$FAKE_GOOGLE_KEY" > "$TMP/dirty/config.js"
printf 'const GEMINI_API_KEY = process.env.GEMINI_API_KEY;\n' > "$TMP/clean/config.js"

set +e
"$GITLEAKS" dir "$TMP/dirty" --config "$CONFIG" --no-banner --exit-code 1 >/dev/null 2>&1
DIRTY_RC=$?
"$GITLEAKS" dir "$TMP/clean" --config "$CONFIG" --no-banner --exit-code 1 >/dev/null 2>&1
CLEAN_RC=$?
set -e

if [ "$DIRTY_RC" -ne 1 ]; then
  echo "selftest FALHOU: gitleaks NÃO acusou a chave Google sintética (exit=$DIRTY_RC). A regra gcp-api-key foi desligada ou enfraquecida." >&2
  exit 1
fi
if [ "$CLEAN_RC" -ne 0 ]; then
  echo "selftest FALHOU: gitleaks acusou um diretório limpo (exit=$CLEAN_RC)." >&2
  exit 1
fi
echo "selftest OK: chave Google sintética -> FAIL (exit 1); árvore limpa -> PASS (exit 0)."
