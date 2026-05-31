# Runbook — QueroUmaCor

> Procedimentos operacionais pra deploy + manutenção. Complementa
> [`../DEPLOYMENT.md`](../DEPLOYMENT.md) (referência detalhada) e
> [`../CLAUDE.md`](../CLAUDE.md) (convenções já decididas).
> Action items que dependem do usuário (não code-actionable) ficam
> em [`../USER_ACTIONS.md`](../USER_ACTIONS.md).

---

## 1. Pré-deploy checklist

Use antes de abrir PR pra `main`:

- [ ] CI verde no PR (`.github/workflows/ci.yml`).
- [ ] Lint + Typecheck + Tests + Build passando localmente.
- [ ] Sem `console.log` em `modules/*` (check em CI via convenções).
- [ ] Sem `TODO`/`FIXME` sem contexto/issue link.
- [ ] **Cache-busting**: se mudou `app.js`, `head.js`, `db.js`,
      `shims.js`, `schemas/*` ou `modules/*` → bumpar `?v=YYYYMMDD<letra>`
      em `index.html` (vanilla apenas — ver
      [`../DEPLOYMENT.md` seção 10](../DEPLOYMENT.md)).
- [ ] Sem segredos commitados (`.env.*` ignorados, sem chave em
      arquivo versionado).
- [ ] Sentry release tagged (auto via integração GitHub + Sentry,
      mas conferir se aparece em sentry.io).
- [ ] **Smoke test em preview** antes do merge:
      `<branch-slug>.queroumacorapp.pages.dev` deve carregar banner
      `STAGING - <hostname>`.

---

## 2. Deploy normal (vanilla, fluxo atual)

1. Branch `claude/*` ou outra ≠ `main` → push.
2. Cloudflare Pages dispara preview deploy automático.
   Aguardar ~90s. URL: `<branch-slug>.queroumacorapp.pages.dev`.
3. **Smoke test no preview**:
   - [ ] Login carrega sem erro JS no console.
   - [ ] Feed renderiza com avatares + media.
   - [ ] Stories aparecem (se houver post recente).
   - [ ] Console limpo (nenhum `Uncaught` / `ReferenceError`).
   - [ ] Network: nenhum 4xx/5xx em `/api/*` no boot.
   - [ ] Sentry sem issue nova abrindo.
4. Merge pra `main` via PR.
5. CF Pages deploy automático (~90s).
6. **Smoke test em produção** `queroumacor.com.br`:
   - [ ] Login + Feed + ações básicas funcionam.
   - [ ] Sentry dashboard sem issue nova.
   - [ ] `/api/health` retorna 200.
7. **Se erro grave**: rollback via
   [Rollback section](#5-rollback-rápido).

Janela típica push→produção: ~90s. Confirmação real só do lado do
usuário (egress do container Claude bloqueia `queroumacor.com.br`,
GitHub MCP não expõe status de deploy CF Pages).

---

## 3. Deploy `next-app/` (cutover futuro)

Bloqueado até o usuário criar o CF Pages project `queroumacor-next`.
Procedimento completo em
[`../USER_ACTIONS.md` seção Cutover](../USER_ACTIONS.md).

Resumo:
1. Setup inicial (uma vez, ~30 min): criar project, KV binding,
   env vars, CNAME `app2.queroumacor.com.br`.
2. Smoke test em `app2.queroumacor.com.br` (1-2 semanas).
3. DNS swap: `queroumacor.com.br` → CNAME `queroumacor-next.pages.dev`.
4. Monitorar Sentry 48h + Mercado Pago webhook 7 dias.
5. Cleanup ~30 dias após cutover estável.

---

## 4. SQL migrations

- **Source-of-truth**: [`/supabase_init.sql`](../supabase_init.sql).
- **Waves históricas** (3, 4, etc.) documentadas em
  [`../CLAUDE.md`](../CLAUDE.md). Não pedir pra rodar de novo —
  já estão no banco.
- **NUNCA via MCP Supabase** — o MCP atual aponta pra OUTRO
  projeto Supabase (não `uwqebaqweehiljsqkifm.supabase.co`). Regra
  registrada em [`../CLAUDE.md`](../CLAUDE.md).

### Procedimento padrão pra novo SQL

1. Claude escreve SQL no chat (bloco de código completo).
2. Usuário copia + cola no Supabase SQL Editor
   (dashboard.supabase.com → Project → SQL Editor).
3. Usuário executa.
4. Claude atualiza `CLAUDE.md` marcando "JÁ EXECUTADO no Supabase".
5. Se altera schema, propagar pra `/supabase_init.sql`.

### Rollback de SQL

- **Supabase PRO**: PITR (point-in-time recovery) — 7 dias de retenção.
- Dashboard → Database → Backups → PITR → escolher timestamp.
- **Cuidado**: PITR restaura o banco INTEIRO. Não dá pra reverter
  só uma tabela isolada.

---

## 5. Rollback rápido

### Rollback de código (Cloudflare Pages)

**Opção A — Workflow GitHub Actions** (recomendado):

1. GitHub → Actions → `Rollback main` → Run workflow.
2. Preencher:
   - `target_sha` (opcional) — SHA alvo. Vazio = `HEAD~1`.
   - `confirm` — literalmente `ROLLBACK` (case-sensitive).
3. Run. Workflow faz `git reset --hard <target>` + `git push --force`.
4. CF Pages deploya a versão antiga (~90s).

**Opção B — Cloudflare Dashboard**:

1. CF Pages Dashboard → project `queroumacorapp` → Deployments.
2. Encontrar deployment estável anterior → "Rollback to this
   deployment".
3. Imediato (sem rebuild).

Use Opção B se a Opção A estiver bloqueada (CI broken, etc.).

### Rollback de banco (Supabase)

- PITR 7 dias (PRO plan).
- Dashboard → Database → Backups → PITR.
- **Cuidado**: ver seção [SQL migrations](#4-sql-migrations).

---

## 6. Monitoring

- **Sentry**:
  - Projeto `queroumacor-app` (vanilla + next-app).
  - Projeto `queroumacor-portal` (portal admin React).
  - Code Mappings GitHub configurados (deep-link pra source).
  - Performance + Session Replay ativos.
- **Health endpoint**: `GET https://queroumacor.com.br/api/health` —
  cron via `.github/workflows/uptime.yml`.
- **Errors table caseira**: `/admin/errors` (gateado por `_isAdmin`)
  — listado os últimos erros gravados em tabela `errors`.
- **Cloudflare Pages Dashboard**: builds, deployments, analytics RUM
  (plano PRO).
- **Web Vitals**: LCP/FID/CLS gravados em tabela `errors` via
  `POST /api/log-error`.

---

## 7. Tarefas frequentes

### 7.1 Limpar cache CDN (Cloudflare)

- Dashboard → Caching → Configuration → Purge Cache.
- Purge by URL pra escopar (não Purge Everything sem necessidade).
- KV cache de `/api/cidades` sobrevive a purge do CDN — pra apagar KV,
  Dashboard → Workers & Pages → KV → namespace `queroumacorapp-cidades`
  → entry → delete.

### 7.2 Rotacionar Supabase service_role key

1. Supabase Dashboard → Project Settings → API → Service Role Key
   → Reset.
2. Copiar nova key.
3. Cloudflare Pages → project `queroumacorapp` → Settings →
   Environment Variables → `SUPABASE_SERVICE_ROLE_KEY` → editar →
   Save.
4. Cloudflare Pages → project `queroumacor-next` (se criado) →
   mesma coisa.
5. **Retry deployment** no painel CF (env vars não propagam sem
   novo deploy).
6. Smoke test endpoints que usam service_role (admin, mp-webhook,
   me-export, upload-style-ref).

### 7.3 Debugar Sentry issue

1. sentry.io → projeto → Issues → escolher issue.
2. Stack trace via Code Mappings vai direto pro arquivo no GitHub.
3. **Em produção (next-app)**: source-maps automáticos via
   `@sentry/nextjs`. Vanilla: stack trace usa source raw (sem map).
4. Replay session (Performance + Session Replay ativos) — clip
   visual do que o usuário fez.
5. **Não há alerting configurado** ainda — issue novo só aparece
   ao olhar o dashboard. Backlog: configurar Sentry alert.

### 7.4 Bumpar cache-bust

Se mudou `app.js`/`head.js`/`db.js`/`shims.js`/`schemas/*`/`modules/*`:

1. Abrir `index.html`.
2. Localizar tags `<script src="...?v=YYYYMMDD<letra>">`.
3. Bumpar: ex.: `?v=20260522a` → `?v=20260522b`. Se já é última
   letra do dia, ir pro próximo: `?v=20260523a`.
4. CI checa que cada path com `?v=` existe no disco — mas NÃO checa
   se o `?v=` foi bumpado. Esquecer = browser serve JS antigo por
   até 1 ano (`max-age=31536000, immutable`).

### 7.5 Adicionar env var ao Cloudflare Pages

1. CF Pages Dashboard → project → Settings → Environment Variables.
2. Add → Production (e Preview se necessário).
3. **Retry deployment** — env vars não propagam até o próximo build.
4. Documentar a var em [`../DEPLOYMENT.md` seção 6](../DEPLOYMENT.md).

### 7.6 Adicionar novo endpoint backend

1. Criar `/functions/api/<nome>.js` (Cloudflare Pages Function ESM).
2. Importar `_security.js` pra `requireAuth`/`requirePro` se aplicável.
3. CORS automático via `_headers` (`/api/*` libera POST + headers).
4. Push em branch → preview deploy → testar com `curl` ou via UI.
5. Catalogar em [`../API.md`](../API.md) (existe).

### 7.7 Adicionar novo módulo `modules/X.js`

1. Criar `modules/X.js` com IIFE registrando `window.Modules.X = {...}`.
2. Em `shims.js`: republicar funções pra `window.X` se HTML inline
   handler chamar `onclick="X()"`.
3. Adicionar `<script defer src="/modules/X.js?v=...">` em
   `index.html` ANTES de `shims.js`.
4. Bumpar `?v=` (ver 7.4).
5. Smoke test no preview.

---

## 8. Convenções deste runbook

- Use checkboxes `- [ ]` pra steps que o operador marca.
- Linkar pra arquivos canônicos (não duplicar conteúdo de
  `DEPLOYMENT.md` aqui).
- Procedimentos não-code-actionable (DNS, CF UI) vão pra
  `USER_ACTIONS.md`.
- Pra novos procedimentos: adicionar em [§7](#7-tarefas-frequentes).
