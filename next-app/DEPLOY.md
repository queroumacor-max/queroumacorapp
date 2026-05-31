# Deploy do `next-app/` (Next.js Path C)

Documento operacional do **subapp Next.js**, que roda em **paralelo** ao
vanilla original em `/`. O vanilla continua servindo `queroumacor.com.br`
sem interrupção durante toda a migração — o Next ganha seu próprio
Cloudflare Pages project e ciclo de deploy.

---

## Pré-requisitos manuais (não-Claude-actionable)

1. **Criar novo Cloudflare Pages project** `queroumacor-next`:
   - Connect repo: `queroumacor-max/queroumacorapp`
   - Production branch: `main`
   - Build command: `cd next-app && npm install && npm run build:cf`
   - Build output directory: `next-app/.vercel/output/static`
   - Root directory: `/` (não `next-app/`, porque os scripts do
     `package.json` cobrem o `cd next-app`)
   - Env vars: copiar de `.env.example`, preencher valores reais. Setar
     em **Production** e **Preview** (podem ser iguais ou separados).

2. **Bindings** (Pages → Settings → Functions):
   - KV namespace: `queroumacorapp-cidades` (mesmo do vanilla) → binding
     name `KV`. Reaproveita o cache `cidades:<UF>` já populado.
   - Compatibility flags: `nodejs_compat` (também declarado no
     `wrangler.toml`).

3. **Custom domain**:
   - Preview branches: `<branch-slug>.queroumacor-next.pages.dev`
     (automático).
   - Staging fixo: `app2.queroumacor.com.br` → CNAME pra
     `queroumacor-next.pages.dev` (criar registro no Cloudflare DNS).
   - Produção: **SÓ DEPOIS DO CUTOVER** (Phase 9 do plano de migração).
     Até lá, `queroumacor.com.br` continua apontado pro Pages project
     vanilla.

4. **Sentry**:
   - Confirmar que o projeto `queroumacor-app` existe em
     `q87.sentry.io` (já existe — usado pelo vanilla).
   - Gerar `SENTRY_AUTH_TOKEN` em sentry.io → Settings → Auth Tokens
     com os scopes `project:read`, `project:releases`, `org:read`.
     Necessário pra upload de source maps no build.
   - Adicionar o token em Pages → Settings → Environment variables
     (Production + Preview).

---

## Local dev

```bash
cd next-app
cp .env.example .env.local  # preencher valores reais
npm install
npm run dev  # http://localhost:3000
```

## Build local (verificar compatibilidade Cloudflare)

```bash
cd next-app
npm run build:cf
# output em .vercel/output/static/
```

O comando `build:cf` roda `next build` seguido do adapter
`@cloudflare/next-on-pages`, que transforma o output do Next em
worker-compatible bundle pro Cloudflare Pages.

## Deploy manual (opcional — normalmente o Pages faz por push)

```bash
cd next-app
npm run build:cf
npm run deploy:preview  # ou deploy:prod
```

Requer `wrangler login` prévio com a conta Cloudflare correta.

---

## Rollback

Como esse subapp roda num Pages project **separado** do vanilla, o
rollback é totalmente isolado:

1. Cloudflare Dashboard → Pages → `queroumacor-next` → Deployments
2. Achar o deploy anterior estável → "Rollback to this deployment"
3. Trafego do `app2.queroumacor.com.br` cai na versão antiga em ~30s

**Não precisa mexer no Pages project vanilla** — `queroumacor.com.br`
nem nota. Se houver problema só no Next, o vanilla segue intacto.

Pra rollback via Git (afeta o build mas não o deploy atual até o próximo
push):

```bash
git revert <sha-quebrado>
git push origin main
```

---

## Coexistência com o vanilla

| Aspecto       | Vanilla (`/`)                          | Next (`next-app/`)                       |
| ------------- | -------------------------------------- | ---------------------------------------- |
| CF Pages proj | `queroumacorapp` (existente)           | `queroumacor-next` (novo)                |
| Domínio       | `queroumacor.com.br`                   | `app2.queroumacor.com.br` (até cutover)  |
| Build         | static + Pages Functions               | `next build` + `@cloudflare/next-on-pages` |
| KV            | binding `KV` → `queroumacorapp-cidades` | binding `KV` → mesmo namespace          |
| Supabase      | mesmo projeto (`uwqebaqweehiljsqkifm`) | mesmo projeto                            |
| Sentry        | `queroumacor-app` (loader script HTML) | `queroumacor-app` (@sentry/nextjs)       |

Ambos compartilham banco, KV e Sentry project — então **erros de
schema/data em um afetam o outro**. Cuidado com migrations.

Detalhes do pipeline vanilla em `../DEPLOYMENT.md`.
