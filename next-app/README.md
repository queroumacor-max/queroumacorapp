# QueroUmaCor — Next.js (Path C migração)

Subaplicação Next.js 15 + TypeScript + React + Tailwind v4 + Supabase, parte
da migração incremental do app vanilla original (raiz do repo).

## Status

**Em scaffold.** O app vanilla original em `/` continua sendo a versão de
produção em `queroumacor.com.br`. Este subapp é desenvolvido em paralelo;
deploy separado (subdomain `app2.queroumacor.com.br` ou novo Pages project).

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 15 (App Router, RSC) |
| Linguagem | TypeScript strict |
| Estilo | Tailwind CSS v4 (`@import "tailwindcss"`) |
| Banco | Supabase Postgres (MESMO do vanilla — sem duplicação) |
| Auth | Supabase Auth |
| Forms | React Hook Form + Zod |
| Server state | TanStack Query |
| Observability | Sentry (mesmo projeto `queroumacor-app`) |
| Testes | Vitest + React Testing Library |
| Deploy | Cloudflare Pages (Next on Pages via `@cloudflare/next-on-pages`) |

## Estrutura

```
next-app/
  app/              # App Router (RSC + client components)
    layout.tsx
    page.tsx        # landing temporária
    login/page.tsx
    info/page.tsx
    api/            # route handlers (migração de /functions/api/)
  lib/              # foundation libs portadas (db, schemas, policies, errors)
  components/       # UI components reusáveis
  types/            # TypeScript types compartilhados
  public/           # assets estáticos
```

## Mapping vanilla → Next.js

| Vanilla | Next.js |
|---|---|
| `/db.js` | `lib/db.ts` |
| `/schemas/*.js` | `lib/schemas.ts` (Zod nativo) |
| `/policies.js` | `lib/policies.ts` |
| `/errors.js` | `lib/errors.ts` |
| `/utils.js` | `lib/utils.ts` |
| `/config.js` | `lib/config.ts` |
| `/logger.js` | `lib/logger.ts` |
| `/head.js` | `lib/supabase.ts` + `lib/auth.ts` + `components/AuthProvider.tsx` |
| `/modules/*.js` | `app/<feature>/*` + `lib/services/<feature>.ts` + `lib/hooks/<feature>.ts` |
| `/functions/api/*.js` | `app/api/*/route.ts` |
| `/index.html` `<div class="screen">` | `app/<feature>/page.tsx` |
| `onclick="loadFeed()"` | `<button onClick={loadFeed}>` |
| `window.X` globals | imports ESM + React Context |
| `shims.js` | DELETADO (não precisa) |

## Comandos

```bash
npm install
npm run dev          # localhost:3000
npm run build
npm run typecheck
npm test
```

## Plano de migração (~10-15 sessões)

Ver `MIGRATION_PLAN.md` na raiz pra ordem de migração das 41 features
restantes + critérios de cutover.

## Status atual do PoC

- `app/login/` + `app/login/LoginForm.tsx` — Server Component shell + Client
  Component form (RHF + Zod). Usa `useAuth().signIn` do `AuthProvider`.
- `app/info/page.tsx` — Server Component menu (cards). Sub-páginas
  (`/info/ajuda`, `/info/privacidade`, `/info/termos`, `/info/sobre`,
  `/info/conta`) ainda **não portadas** — retornam 404 até PR futuro.
  WhatsApp/email viram `<a href="https://wa.me/..."`>` puro (sem JS).
- `components/AuthProvider.tsx` — Context com `user/session/loading +
  signIn/signOut`. Wired no `app/layout.tsx`.
- `middleware.ts` — **não criado**. Login e Info são públicas; adicionar
  quando portar primeira rota privada (ex.: `/me`, `/feed`).

## Stubs temporários

- `lib/schemas.ts` — stub mínimo (`emailSchema`, `passwordSchema`,
  `strongPasswordSchema`) até foundation libs serem portadas com a versão
  definitiva (do vanilla `/schemas/*.js` + `/policies.js`).
