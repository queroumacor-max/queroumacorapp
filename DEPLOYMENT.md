# Deployment Pipeline — QueroUmaCor

Documento de referencia operacional do pipeline de deploy. Cobre stack,
branching, CI, rollback, cache, CSP, e armadilhas conhecidas.

---

## 1. Stack

| Camada    | Provedor                                                                 |
| --------- | ------------------------------------------------------------------------ |
| Hosting   | Cloudflare Pages (plano PRO)                                             |
| Backend   | Cloudflare Pages Functions (V8 isolates) em `/functions/api/`            |
| Banco     | Supabase Postgres (plano PRO) — `uwqebaqweehiljsqkifm.supabase.co`       |
| DNS       | Cloudflare — `queroumacor.com.br`                                        |

Tudo serverless: zero VMs, zero containers, zero runtime fixo. O deploy
consiste em publicar arquivos estaticos + Pages Functions no edge.

---

## 2. Branches e deploys

| Branch              | Destino                                                | Como             |
| ------------------- | ------------------------------------------------------ | ---------------- |
| `main`              | `https://queroumacor.com.br`                           | Auto (~90s)      |
| qualquer outra      | `https://<branch-slug>.queroumacorapp.pages.dev`       | Auto preview     |

- Push em `main` dispara o build de producao do Cloudflare Pages. Janela
  tipica de deploy: ~90 segundos do push ate o trafego cair na nova
  versao.
- Push em qualquer outra branch gera um preview deploy isolado, com
  hostname derivado do slug da branch (caracteres especiais viram `-`,
  tudo lowercase).
- O app detecta `location.hostname` e injeta um banner amarelo
  `STAGING - <hostname>` no topo da tela quando NAO esta rodando em
  `queroumacor.com.br`.
- Preview deploys ganham `X-Robots-Tag: noindex` automaticamente — Google
  nao indexa.
- Preview e producao compartilham o MESMO banco Supabase e as MESMAS env
  vars (a menos que esteja diferenciado no painel Cloudflare entre
  "Preview" e "Production"). Cuidado com testes destrutivos.

Detalhes em [STAGING.md](./STAGING.md).

---

## 3. CI (`.github/workflows/ci.yml`)

Roda em:
- `push` em qualquer branch que NAO seja `main`
- `pull_request` direcionado a `main`
- `workflow_dispatch` manual

Job `validate` (Ubuntu, timeout 5min):

1. `actions/checkout@v4`
2. `actions/setup-node@v4` com Node 20 + cache npm
3. `npm ci` — instalacao limpa das deps
4. **Syntax check (`node -c`)** sobre `app.js`, `head.js`, `db.js`,
   `validators.js`, `types.js`, `sw.js`. Pega erros de parse antes do
   deploy.
5. **Asset reference check** — grep no `index.html` pega cada path
   referenciado com `?v=`, verifica que o arquivo existe no disco. Falha
   se a tag aponta pra arquivo inexistente (catch comum quando se bumpa
   `?v=` mas digita o caminho errado).
6. **Tests (Vitest)** — `npm test -- --passWithNoTests`.

Concorrencia: novos pushes na mesma ref cancelam runs anteriores
(`cancel-in-progress: true`).

CI eh informativo — atualmente nao bloqueia merge a menos que branch
protection no GitHub esteja explicitamente exigindo o status do job.

---

## 4. Rollback (`.github/workflows/rollback.yml`)

Workflow manual via `workflow_dispatch` para reverter `main` para um
commit anterior.

Inputs:
- `target_sha` (opcional) — SHA alvo. Default vazio = `HEAD~1`.
- `confirm` (obrigatorio) — precisa ser literalmente a string
  `ROLLBACK`, caso contrario o job falha no primeiro step.

Fluxo:
1. Valida `confirm == "ROLLBACK"`.
2. Checkout de `main` com `fetch-depth: 0`.
3. Configura identidade git como `claude-bot`.
4. `git reset --hard <target>`.
5. `git push --force origin main`.

O force push em `main` dispara o deploy automatico do Cloudflare Pages
da versao antiga. Use quando um deploy quebrar producao e a correcao
demorar mais do que voltar.

Como acionar: GitHub UI -> Actions -> "Rollback main" -> Run workflow ->
preencher `confirm=ROLLBACK` -> Run.

---

## 5. Dependabot (`.github/dependabot.yml`)

Dependabot v2. Abre PRs semanais (segundas) com bumps de versao.

| Ecosystem        | Diretorio | Limite PRs | Grupos               |
| ---------------- | --------- | ---------- | -------------------- |
| `npm`            | `/`       | 5          | `dev-dependencies`*  |
| `github-actions` | `/`       | 3          | (sem agrupamento)    |

\* Dev deps agrupadas num unico PR por semana (`dependency-type: development`).

Labels aplicadas: `dependencies` + (`npm` ou `github-actions`).

Para pausar: comentar o bloco `updates` ou apagar o arquivo. Fechar um PR
faz o Dependabot respeitar a decisao.

---

## 6. Env vars (Cloudflare Pages -> Settings -> Environment variables)

Configurar em **Production** e (se diferente) em **Preview**.

| Variavel                    | Uso                                                                |
| --------------------------- | ------------------------------------------------------------------ |
| `SUPABASE_URL`              | Endpoint do Supabase                                               |
| `SUPABASE_ANON_KEY`         | Chave anon (publica, RLS-protected)                                |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service_role (so server-side, bypassa RLS)                   |
| `OPENAI_API_KEY`            | Usada por `chat-ai.js` (ja configurada)                            |
| `GEMINI_API_KEY`            | Usada por `resolve-color.js` (ja configurada)                      |
| `MP_ACCESS_TOKEN`           | Mercado Pago — criacao de cobrancas                                |
| `MP_WEBHOOK_SECRET`         | Mercado Pago — validacao de webhook                                |
| `ADMIN_EMAILS`              | Lista comma-separated de e-mails com privilegios admin             |
| `SENTRY_DSN`                | Opcional. Hoje DSN esta hardcoded no HTML via loader script        |

Apos mudar uma env var, o Cloudflare Pages exige um novo deploy para
propagar (pode ser um deploy vazio via "Retry deployment" no painel).

---

## 7. Cache strategy (`_headers`)

### Assets versionados (cache longo, immutable)

Servidos com `Cache-Control: public, max-age=31536000, immutable`:

- `/head.js`, `/app.js`, `/db.js`, `/validators.js`, `/shims.js`
- `/errors.js`, `/logger.js`, `/policies.js`, `/config.js`, `/utils.js`
- `/modules/*` (todos os 44 modulos da Fase 4)
- `/supabase.js`, `/jspdf.umd.min.js`
- `/portal/app.js`, `/portal/react.production.min.js`,
  `/portal/react-dom.production.min.js`
- `/leaflet.js`, `/leaflet.css`
- `/fonts/*` (woff2)

Premissa: o nome do arquivo nao muda, mas a tag `<script>` no HTML
carrega com `?v=YYYYMMDD<letra>`. O CDN/browser cacheia 1 ano; quando o
HTML referencia uma nova querystring, o browser baixa de novo.

### Documentos que sempre revalidam

`Cache-Control: public, max-age=0, must-revalidate`:

- `/` (raiz)
- `/index.html`
- `/portal/index.html`
- `/sw.js` (+ header `Service-Worker-Allowed: /` pra escopo amplo)

### API

`/api/*`:
- `Cache-Control: no-store`
- CORS restrito a `https://queroumacor.com.br`
- Metodos: `GET, POST, OPTIONS`
- Headers permitidos: `Content-Type, Authorization`
- `Vary: Origin`

### SEO

`/robots.txt` e `/sitemap.xml`: `public, max-age=86400` (1 dia).

### Style refs (Arte IG)

`/style-refs/*`: `public, max-age=604800` (1 semana — troca rara).

---

## 8. Routing (`_redirects`)

```
/portal/*  /portal/index.html  200   # SPA fallback do portal
/api/v1/*  /api/:splat         200   # versionamento de API
/api/*     /api/:splat         200   # rota canonica
/*         /index.html         200   # SPA fallback principal
```

Todos os rewrites sao status `200` (interno) — a URL no browser nao muda.

A linha `/api/v1/* -> /api/:splat` eh o alias da versao atual. Quando
houver quebra de contrato, novos endpoints vivem em `/api/v2/X.js` e o
`/api/v1` continua apontando pros antigos ate desativacao.

---

## 9. CSP (`_headers`)

Politica completa no header `Content-Security-Policy` aplicada a `/*`.

Diretivas principais:

| Diretiva               | Permite                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `default-src`          | `'self'`                                                             |
| `script-src`           | `'self' 'unsafe-inline'`, `challenges.cloudflare.com`, `*.sentry-cdn.com` |
| `style-src`            | `'self' 'unsafe-inline'`, `fonts.googleapis.com`                     |
| `font-src`             | `'self'`, `fonts.gstatic.com`                                        |
| `img-src`              | `'self' data: blob: https:`                                          |
| `media-src`            | `'self' blob: data:`                                                 |
| `connect-src`          | `'self'`, `*.supabase.co`, `wss://*.supabase.co`, `challenges.cloudflare.com`, `*.ingest.sentry.io`, `*.ingest.us.sentry.io`, `sentry.io`, `*.sentry.io` |
| `frame-src`            | `challenges.cloudflare.com`                                          |
| `frame-ancestors`      | `'none'` (anti-clickjacking)                                         |
| `worker-src`           | `'self' blob:`                                                       |
| `object-src`           | `'none'`                                                             |
| `base-uri`/`form-action` | `'self'`                                                           |
| `upgrade-insecure-requests` | ativo                                                           |

Headers complementares:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` restritivo (microfone/camera/geolocation/payment self; demais negados)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (preload pendente — lembrete em 07/07/2026)
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

Nota: `challenges.cloudflare.com` permanece em `script-src`/`connect-src`/
`frame-src` mesmo com o widget Turnstile removido do HTML — basta
reincluir a tag pra reativar sem mexer em CSP.

---

## 10. Cache-busting protocol

**Regra:** SEMPRE bumpar `?v=YYYYMMDD<letra>` no `index.html` ao mudar
qualquer um destes arquivos:

- `app.js`
- `head.js`
- `db.js`
- `shims.js`
- `validators.js`
- qualquer `modules/*.js`
- (qualquer outro arquivo na lista de assets immutables da secao 7)

Formato: data ISO + letra incremental do dia. Exemplo:
`?v=20260522a` -> `?v=20260522b` -> `?v=20260523a`.

Esquecer = navegador serve o JS antigo do cache (`max-age=31536000,
immutable`) e a correcao nao chega no usuario por ate 1 ano. O step
"Asset reference check" do CI pega caminho errado, mas NAO pega versao
nao-bumpada.

O CI tambem so checa `index.html`. Se um asset versionado existir em
outro HTML (raro), bumpar manualmente la tambem.

---

## 11. Sentry (observability, opcional)

- Loader scripts no HTML (`index.html` e `portal/index.html`) com DSN
  hardcoded. Sentry esta ligado ao GitHub do projeto (releases /
  commits / issues sincronizados).
- Code Mappings configurados via UI Sentry:
  - `queroumacorapp/` -> projeto `queroumacor-app`
  - `portal/` -> projeto `queroumacor-portal`
- Performance + Session Replay ativos em ambos os projetos.
- Convive com a tabela caseira `errors` + dashboard `/admin/errors`.
  Decisao se Sentry vira fonte primaria ou complemento esta em aberto.
- Para ligar forwarding server-side em `/api/log-error`, criar env var
  `SENTRY_DSN` no Cloudflare Pages e wirar no handler. CSP ja libera os
  hosts Sentry em `connect-src`.

---

## 12. Limitacoes conhecidas do ambiente Claude (nao-action)

- **Egress bloqueado** pra `queroumacor.com.br` (e demais hosts de
  producao) — Claude nao consegue `curl` confirmar que o deploy
  realmente subiu.
- **GitHub MCP nao expoe status de deploy do Cloudflare Pages.** O MCP
  ve actions, PRs, issues — nao ve o deploy do Pages.
- **Confirmacao manual:** apos merge em `main`, aguardar a janela tipica
  (~90s) e pedir ao usuario que confirme se o site esta com a versao
  nova. Claude pode rodar `sleep 90 && echo deploy-pronto` em background
  pra marcar o tempo, mas isso eh tempo decorrido — nao verificacao.
- **MCP Supabase aponta pra outro projeto** (NAO o queroumacor
  `uwqebaqweehiljsqkifm.supabase.co`). Qualquer `execute_sql` /
  `list_tables` / `apply_migration` via MCP vai pro projeto errado.
  Para SQL do queroumacor: colar no chat, usuario roda no SQL Editor.

---

## Checklist rapido pra um deploy

1. Branch de trabalho (nao `main`).
2. Mudou `app.js`/`head.js`/`db.js`/`shims.js`/`modules/*.js`? Bumpar
   `?v=` no `index.html`.
3. Commit + push -> CI roda (~2 min) + preview deploy (~90s).
4. Testar no preview (`<branch>.queroumacorapp.pages.dev`). Banner
   amarelo "STAGING" confirma ambiente.
5. Merge em `main`.
6. Aguardar ~90s + pedir confirmacao do usuario que producao subiu.
7. Se quebrou: rodar workflow "Rollback main" com `confirm=ROLLBACK`.
