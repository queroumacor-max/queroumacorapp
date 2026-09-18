---
tags: [segurança, auditoria, ci-cd, github-actions, supply-chain]
---

# Auditoria de Segurança da Pipeline CI/CD

**Data:** 2026-09-16, commit `bfa6849`, merge #318 (`claude/keen-bell-vyn38f`).
**Status:** mergeada; documentada em 2026-09-17 (chegou a ficar sem registro — lição de processo, ver fim).

Modelo de ameaça: *"PR de fork controla arquivos/deps/scripts, tenta ler secret ou publicar artifact malicioso"*. Tudo corrigido no mesmo commit:

- `deploy.yml` **parou de passar `SUPABASE_SERVICE_ROLE_KEY`** pro `next build` (desnecessário — a chave é lida via `getRuntimeEnv()` em runtime, nunca build-time).
- **Actions de terceiros pinadas por SHA completo** (antes tag mutável): `cloudflare/wrangler-action`, `gitleaks/gitleaks-action`, `zaproxy/action-baseline`, `grafana/setup-k6-action`.
- `npm install` → **`npm ci`** em `deploy.yml` e `ios-screenshots.yml`.
- **`persist-credentials: false`** nos checkouts de jobs sem push (`ci`, `deploy`, `security`, `load-test`, `ios-screenshots`).
- `rollback.yml` interpolava `${{ github.event.inputs.* }}` direto em `run:` (shell injection) → movido pra `env:`; `target_sha` começando com `-` recusado.
- `.gitleaksignore` estava desatualizado (chave Gemini vazada, já revogada) — corrigido.
- **`sharp` 0.34.5 → 0.35.4** (CVE HIGH fechado, não-breaking).
- **Scanners novos**: `.github/workflows/codeql.yml` (SAST), job `sbom` em `security.yml` (SBOM CycloneDX), `.github/SECURITY.md` (canal `loja@calicolors.com.br`).

## Confirmado, já correto, sem mudança
Nenhum workflow usa `pull_request_target`; `pull_request` roda com `GITHUB_TOKEN` read-only; `deploy.yml` só dispara por `workflow_dispatch` com `if: github.ref == 'refs/heads/main'`; `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` são STEP-scoped.

## Permissões de organização/branch protection — conferido à mão (2026-09-17)
Só 2 colaboradores: `jacksongmatos` (write) e `queroumacor-max` (admin, dono) — nenhum externo. Branch protection do `main` com check `validate` obrigatório confirmado (recusa `405 Required status check`).

## Lição de processo
Essa sessão não seguiu a própria regra do `SECURITY_AUDIT_LOG.md` de registrar toda auditoria — merge #318 chegou na `main` sem passar pelas entradas de doc-sync que vieram depois (SSL/TLS, DNSSEC/CAA).

---
## Ver também
[[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]]
