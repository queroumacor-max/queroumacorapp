# MANUAL ACTION REQUIRED — CRITICAL: rotação da chave Gemini

**Status: PENDENTE** (auditoria de segredos, 2026-09-11). Enquanto esta
página disser PENDENTE, a auditoria do repositório NÃO pode ser
classificada como SECURE.

## O que vazou

- **Credencial:** Google API key do Gemini (formato `AIzaSy…`, 39 caracteres).
- **Onde:** `queroumacorportal.html` (portal legado, código de FRONTEND),
  linha 429, commit `a7355313…` (05/2026). Removida do código no commit
  `10ff6d20…`, mas o histórico do Git é público e imutável.
- **Exposição:** além do Git, rodava no navegador de quem abria o portal —
  qualquer pessoa podia copiá-la do "ver código-fonte".
- **Registro no scanner:** `.gitleaksignore` (fingerprint da linha). Ali NÃO
  está o valor, só o endereço do vazamento.

Nada no repo hoje usa essa chave; o app lê `GEMINI_API_KEY` do painel do
Cloudflare Pages em runtime. Não há como saber daqui se a chave antiga é a
mesma que está no painel.

## Como rotacionar (só o dono da conta Google faz)

1. Abrir o Google AI Studio (ou o projeto do Google Cloud que emitiu a
   chave) → **API keys**.
2. Criar uma chave NOVA. Restringir por API ("Generative Language API")
   quando o painel oferecer.
3. No Cloudflare Pages → projeto do app → Settings → Environment variables
   → **Production**: trocar o valor de `GEMINI_API_KEY` pela chave nova,
   marcada como **Secret**. Refazer o deploy (Retry deployment).
4. Só depois do deploy no ar: **revogar/apagar a chave antiga** no Google.
5. Trocar a linha de `.gitleaksignore` de "ROTAÇÃO PENDENTE" para
   "ROTACIONADA em AAAA-MM-DD" e mudar o status desta página.

## Como CONFIRMAR que a rotação fechou (checklist)

Cada item tem um comando ou uma tela. Nenhum exige colar a chave no repo.

| # | O que provar | Como |
|---|---|---|
| 1 | A chave antiga está inválida | `curl -s -H "x-goog-api-key: <CHAVE_ANTIGA>" https://generativelanguage.googleapis.com/v1beta/models` deve responder `400`/`403` com `API_KEY_INVALID`. Rodar no computador, não no repo. |
| 2 | A chave nova existe só em secret/env | Painel do CF Pages mostra `GEMINI_API_KEY` como Secret (valor oculto). Nenhum `.env*` commitado: `git ls-files | grep -E '\.env'` só lista `next-app/.env.example`. |
| 3 | A chave nova não está no Git | `gitleaks git .` na raiz responde `no leaks found`; `git log -p --all -S'<PRIMEIROS_8_CHARS_DA_NOVA>'` não devolve nada. |
| 4 | A chave nova não está no bundle do frontend | Depois do deploy: `curl -s https://www.queroumacor.com.br/_next/static/chunks/<qualquer>.js \| grep -c AIza` = 0. Localmente: `npm run build` e `grep -r AIza next-app/.next/static` vazio. O teste `__tests__/lib/secret-hygiene.test.ts` trava que código de cliente não lê `GEMINI_API_KEY`. |
| 5 | A chave nova não vai pra logs nem pro Sentry | O código manda a chave no header `x-goog-api-key` (nunca em `?key=`), e `sentryBeforeSend` redige `AIza…`, headers e query strings (`__tests__/lib/sentry-helpers.test.ts`). No Sentry, abrir um evento recente de rota de IA e conferir que `request`/`breadcrumbs` não carregam `AIza`. |
| 6 | O app continua funcionando | Chamar `GET /api/ig-art-diag` (admin) — `gemini.configured: true` e `total > 0`. Gerar uma legenda no composer e uma moderação de foto. Com chave inválida a rota devolve `HTTP 400: API key not valid` no campo `gemini.error`. |

## Por que não dá pra "corrigir por código"

Remover a chave do código não a invalida. Reescrever o histórico do Git
também não: o commit já foi clonado, indexado e servido em produção. A única
correção é a rotação acima.
