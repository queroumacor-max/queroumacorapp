# ADR 0005 — Observabilidade em camadas (Sentry + tabela `errors` caseira)

- **Status**: Accepted
- **Date**: 2026-05-31
- **Deciders**: mantenedor único
- **Tags**: observability, errors, monitoring, sentry

## Context

O QueroUmaCor precisa observar:

- Erros JS no client (window.onerror, unhandledrejection).
- Exceptions em endpoints serverless.
- Web Vitals (LCP, FID, CLS) — relevante pra PWA mobile.
- Uptime do backend.
- Eventos de negócio que indicam regressão silenciosa (follow não
  persistiu, payment webhook não creditou, story não salvou como
  vista).
- Auditoria por usuário admin sem login externo (Sentry tem custo de
  contas; dashboard interno é direto pelo app).

Quando a infra cresceu, surgiu a pergunta natural: **Sentry resolve
tudo. Por que manter tabela `errors` caseira e dashboard
`/admin/errors`?** Inversamente: **se temos tabela caseira, por que
adicionar Sentry?**

Estado factual:

- Sentry está **conectado ao GitHub do projeto** (releases / commits /
  issues sincronizados). Code Mappings configurados:
  `queroumacorapp/` → projeto `queroumacor-app`; `portal/` → projeto
  `queroumacor-portal`. Performance + Session Replay ativos.
- Loader script Sentry está no `index.html` e em `portal/index.html`
  com DSN hardcoded. CSP já libera `*.sentry.io` e
  `*.sentry-cdn.com` em `script-src`/`connect-src`/`frame-src`.
- `POST /api/log-error` recebe erros do client (`window.onerror`,
  `unhandledrejection`) + Web Vitals. Persiste em tabela `errors` no
  Supabase. Rate-limit aplicado. Truncate a 2KB por campo.
- Tabela `errors` no Supabase tem RLS — leitura só via service-role.
- Dashboard `/admin/errors` no app (modal, gate `_isAdmin`) lista os
  últimos erros. Bate em `/api/admin-errors-list`.
- `/api/health` pra uptime externo (Uptime Robot ou similar).
- Forwarding server-side pra Sentry em `/api/log-error` **ainda não
  está wirado** — DSN existe, mas o handler não envia.

## Decision

**Mantemos as duas camadas convivendo, sem decidir ainda qual vira
fonte primária.** Cada uma cobre um gap que a outra não cobre bem:

### Camada A — Sentry (vendor SaaS)

- Sentry SDK no client captura erros automaticamente (incluindo erros
  fora dos nossos try/catch).
- Session Replay grava o último minuto da UI quando um erro estoura
  — debug visual de bug intermitente.
- Performance tracing mostra spans (fetch lento, render pesado).
- Integração com GitHub: cada release vincula a commits; issues do
  Sentry abrem PRs/issues do GitHub; commits "fixam" issues.
- Alerta por email/Slack via UI Sentry (não precisa código).
- Cobre crashes em código client que NÃO passou por `reportError()`.

### Camada B — Tabela `errors` + `/admin/errors`

- Endpoint `/api/log-error` recebe **erros explícitos do app**
  (`reportError({ type, ctx, msg })`) + Web Vitals.
- Persiste em Supabase com schema controlado: `id`, `created_at`,
  `user_id`, `type`, `ctx`, `msg`, `meta`. Filtros úteis (por usuário,
  por feature, por janela) via SQL puro.
- Dashboard `/admin/errors` no próprio app — admin abre o modal sem
  precisar Sentry login. Útil pra debug ao vivo durante sessão de
  suporte ("o que aconteceu no celular do João?").
- Sem custo SaaS marginal (paga só Supabase, que já está no plano PRO).
- Retention controlada por nós (purge via SQL quando quiser).
- Pode capturar **eventos não-erro**: "follow não persistiu mesmo com
  insert ok" (verify-after-write detectou drift) → `reportError({
  type:'follow-not-persisted' })`. Sentry quer exception; tabela
  aceita evento estruturado.

### Como convivem

- Erros explícitos do app → `reportError()` → `/api/log-error` → tabela
  `errors`. Estes são os "eventos curados".
- Erros auto-capturados → Sentry SDK. Estes são "tudo que vazou pra
  fora dos try/catch".
- Web Vitals → tabela `errors` (campo `type='vital'`). Sentry
  Performance cobre também — duplicação aceita.
- Health checks → `/api/health` (externo polla, sem Sentry/tabela).

Forwarding server-side Sentry em `/api/log-error` está documentado como
opcional (env var `SENTRY_DSN`, CSP já permite). Quando wirar, cada
erro vai pra ambos os destinos — passo 1 da migração eventual pra
"Sentry como fonte primária".

## Consequences

### Positive

- **Cobertura redundante.** Erro que escapa do `reportError()` ainda
  cai no Sentry. Erro que estoura `try/catch` mas é evento de negócio
  importante ainda vai pra `errors` (com contexto rico).
- **Debug imediato sem login externo.** Suporte em chat com usuário?
  Abre `/admin/errors`, filtra por user_id, vê os últimos erros.
  Sem precisar logar no Sentry.
- **Custo controlado.** Tabela `errors` no Supabase PRO não cobra extra.
  Sentry free tier cobre volume atual; upgrade só quando volume justificar.
- **GitHub integration grátis no Sentry.** Releases e commits ligam
  automaticamente — visibilidade de regressão por deploy.
- **Session Replay no Sentry é killer feature.** Vê o cursor andando
  até o crash. Tabela caseira não tem como replicar isso.
- **Schema próprio da tabela serve eventos.** "Follow não persistiu",
  "checkout abandonado no step 3" são eventos, não exceptions —
  cabem natural na tabela mas torcem o modelo de Sentry.

### Negative

- **Duplicação.** Web Vitals e alguns erros vão pra dois lugares.
  Confusão potencial: "consultar onde?".
- **Dois lugares pra olhar.** Admin precisa lembrar de checar Sentry +
  `/admin/errors`. Mitigação: documentar em `CONTRIBUTING.md §9` ("após
  merge: olhar os dois por 10min").
- **Sentry adiciona dep externa.** Bloqueio Sentry (raro) significa
  perder a camada A. Camada B (tabela) continua funcionando.
- **DSN hardcoded no HTML.** Quem inspeciona JS vê o DSN. Aceitável
  porque Sentry DSN é projetado pra ser público (não permite leitura de
  erros, só ingestão).
- **CSP adicionada pra Sentry.** `*.sentry.io`, `*.sentry-cdn.com`
  liberados em script/connect. Pequena ampliação de superfície.
- **Decisão pendente.** "Sentry vira fonte primária ou só
  complemento?" — não decidido. Custo: cada vez que aparece uma
  feature de observability, perguntamos onde vai. Aceito enquanto
  volume não justifica forçar a decisão.
- **Forwarding `/api/log-error` → Sentry não está wirado.** Se decidir
  consolidar em Sentry, é trabalho extra. Mitigação: CSP e env var já
  estão preparados.

## Alternativas consideradas

- **Só Sentry.** Perde dashboard interno (admin precisa login externo),
  perde controle de schema de eventos, perde retention configurável.
  Bom o suficiente pra equipes maiores; nosso suporte beneficia muito
  do dashboard caseiro.
- **Só tabela `errors`.** Perde auto-capture (a maioria dos erros JS
  escapa de `reportError()` sem isso). Perde Session Replay. Inviável
  pra debug profundo.
- **Datadog / New Relic / Honeycomb.** Overkill pra esse tamanho. Custo
  alto. Sentry free tier resolve o equivalente.
- **Logflare / Axiom + Supabase logs.** Pode complementar no futuro,
  mas adiciona 3ª camada sem necessidade hoje.

## Quando re-avaliar

- Se Sentry virar útil o bastante e tabela `errors` ficar subutilizada
  por 3+ meses → migrar pra Sentry-only, criar wrapper compat no
  `reportError()`, descontinuar dashboard.
- Se Sentry passar de free tier e custo for >$50/mês → reavaliar se
  Session Replay e Performance valem.
- Se aparecer feature de observability que NÃO cabe nem em Sentry nem
  na tabela (tracing distribuído entre Pages Functions + Supabase
  triggers), considerar OTel + backend dedicado.
- Se forwarding `/api/log-error` → Sentry for wirado e funcionar bem
  por 1 mês, considerar deprecar a tabela e mover dashboard pra
  Sentry API.

## Referências

- `ARCHITECTURE.md §Observabilidade`
- `DEPLOYMENT.md §11` (Sentry config detail), `§9` (CSP)
- `CONTRIBUTING.md §9`
- `functions/api/log-error.js`, `functions/api/admin-errors-list.js`,
  `functions/api/health.js`
- `CLAUDE.md` (estado: "Sentry JÁ ESTÁ CONECTADO ao GitHub do projeto")
- ADR 0003 (Cloudflare Functions — onde `/api/log-error` roda)
