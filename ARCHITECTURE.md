# Arquitetura — QueroUmaCor

> Estado **atual** da arquitetura (2026-06-14). A SPA vanilla legada
> (`index.html` + `app.js` + `modules/` IIFE) **foi removida** — produção é
> 100% Next.js em `next-app/`. O histórico do port vanilla→Next vive em
> `MIGRATION_PLAN.md`. Convenções e SQL já rodado em `CLAUDE.md`; workflow de
> preview em `STAGING.md`.

## Stack

| Camada | Tecnologia |
|---|---|
| **Framework** | Next.js 15 (App Router) + React 19 + TypeScript strict |
| **Hosting** | Cloudflare Pages (PRO) via `@cloudflare/next-on-pages` (V8 isolates / edge runtime) |
| **Banco** | Supabase Postgres (PRO) + Auth + Storage + Realtime + RLS |
| **Estado/dados no client** | TanStack Query v5 (cache, stale-while-revalidate, mutations otimistas) |
| **Estilo** | Tailwind CSS v4 + CSS vars (tema claro/escuro sem FOUC) |
| **Pagamentos** | Mercado Pago (web) + stubs IAP StoreKit/Play (lojas) |
| **IA** | OpenAI + Gemini com fallback (`lib/api/_ai.ts`) |
| **Observabilidade** | Sentry v8 (erros + Web Vitals RUM + breadcrumbs) + tabela `errors` caseira |
| **Mobile** | PWA (Service Worker + Web Push) + Capacitor (iOS) + Android TWA |
| **Testes** | Vitest (~1000 testes, 80 arquivos) |
| **CI/CD** | GitHub Actions + auto-deploy Cloudflare Pages a partir de `main` |

## Estrutura do repo

- `next-app/` — **a aplicação** (Next.js App Router).
  - `app/` — rotas (50+) e route handlers de API (`app/api/*`).
  - `components/` — ~35 componentes compartilhados (Avatar, PostCard, BottomSheet, providers).
  - `lib/services/` — ~46 services (I/O puro contra Supabase, sem DOM).
  - `lib/hooks/` — ~45 hooks (TanStack Query sobre os services).
  - `lib/api/` — lógica server-side dos endpoints (`security.ts`, `env-check.ts`, `_ai.ts`, etc.).
  - `lib/` — fundacionais: `supabase.ts`, `policies.ts`, `schemas.ts`, `types.ts`,
    `errors.ts`, `db.ts`, `cfImg.ts`, `toast.ts`, `auth-server.ts`.
  - `__tests__/` — Vitest.
  - `public/` — assets estáticos, Service Worker, manifest.
- `migrations/*.sql` — migrations numeradas (waves). **Source of truth** do schema
  junto com `supabase_init.sql`.
- `docs/` — `BILLING_STRATEGY.md`, `IOS_BUILD.md`, `ANDROID_BUILD.md`,
  `CSAM_POLICY.md`, `PUSH_NOTIFICATIONS.md`.
- `capacitor.config.ts`, `ios/`, `twa-manifest.json`, `.well-known/` — empacotamento mobile.
- Docs na raiz: `CLAUDE.md`, `LAUNCH_AUDIT.md`, `RELEASE_AUDIT.md`,
  `MIGRATION_PLAN.md`, `STAGING.md`, `BACKLOG.md`, `DATABASE.md`, `DEPLOYMENT.md`.

## Frontend (`next-app/app/`)

App Router misturando **Server Components** (shells, gates de auth em `/admin/*`)
com **Client Components** (`'use client'` — interatividade + hooks).

Providers globais em `app/layout.tsx` (ordem importa):

```
<AuthProvider>          ← sessão Supabase no Context (substitui o currentUser global)
  <QueryProvider>       ← TanStack QueryClient + persistência
    <DialogProvider>    ← modais/confirm imperativos
      {children}
      + ToastViewport, StagingBanner, EmailVerifyBanner,
        ReferralCapture, ServiceWorkerRegister
```

Grupos de rotas:
- **Auth/onboarding:** `/`, `/login`, `/signup` (3 steps), `/reset-password`, `/update-password`
- **Social/feed:** `/feed`, `/post/[id]`, `/explore`, `/search`, `/hashtag/[tag]`, `/notificacoes`, `/publicar`
- **Perfil:** `/perfil`, `/perfil/[id]`, `/perfil/editar`, `/perfil/formacao`, `/perfil/grafites` (AR), `/perfil/bloqueados`
- **Profissional (PRO + role gates):** `/orcamentos`, `/orcamento-ia`, `/agenda`, `/financeiro`,
  `/crm`, `/checklist`, `/calculadora`, `/leads`, `/notes` + assistentes IA
  `/seu-ze`, `/fe`, `/senna`, `/alice`, `/arte-ig`, `/ai-logo`
- **Loja:** `/loja`, `/loja/[id]`, `/loja/carrinho`, `/pedidos`, `/camisetas`
- **Chat:** `/chat`, `/chat/[convId]` (realtime + unread)
- **Pontos/PRO:** `/pontos`, `/pro`
- **Info/LGPD:** `/info/*`, `/delete-account`
- **Admin (RSC + `requireAdminServer()`):** `/admin/products`, `/admin/reports`,
  `/admin/feature-interest`, `/admin/media-review`, `/admin/errors`

## Camada de dados (padrão central)

Fluxo unidirecional em 3 camadas — sem `sb.from()` espalhado em componentes:

```
Componente (UI)
   │ usa
   ▼
Hook (lib/hooks/*)            ← TanStack Query: cache, staleTime, mutations otimistas
   │ chama
   ▼
Service (lib/services/*)      ← I/O puro contra Supabase, types inline, sem DOM
   │ via
   ▼
getSupabase() (lib/supabase.ts)
   ▼
Supabase PostgREST / RPC / Realtime / Storage
```

- **Services** lançam `NetworkError`/`ValidationError`; são funções puras testáveis.
- **Hooks** aplicam otimismo + rollback (like/save/comment/delete).
- **Feed:** RPC `get_feed_v2` (1 round-trip agrega post+autor+likes+comments+boost)
  com fallback legacy de 5 queries; cursor (keyset) pagination; `initialData` pra
  pular refetch inicial.

## Backend / API (`app/api/` + `lib/api/`)

~34 route handlers em edge runtime. Cada `app/api/X/route.ts` é fino e delega pra
`lib/api/X.ts` (testável). Infra:

- **`security.ts`** — `requirePro()`, `gateAiUsage()` + `recordAiUsage()`.
  **Fail-closed em prod** sem `SUPABASE_SERVICE_ROLE_KEY` (503).
- **`env-check.ts`** — `assertProductionEnvs()` no boot; throw se faltar env crítica.
- **`auth-server.ts` / `requireAdminServer()`** — gate dos RSC `/admin/*` via cookie
  httpOnly `sb-session-token`.
- **`_ai.ts`** — wrapper OpenAI ↔ Gemini com fallback.
- **`mediaHash.ts`** + **`audit.ts`** — SHA-256 de mídia (CSAM) + trilha de auditoria.

Categorias: IA (14 endpoints), pagamentos (`checkout`, `mp-checkout-loja`,
`mp-webhook`, `apple-iap-verify`, `play-billing-verify`), auth
(`auth/set-session-cookie`, `auth-rate-check`), LGPD (`me-export`, `delete-account`),
push (`push-notify`), admin, `health`, `log-error`.

**Toda IA** passa por `gateAiUsage` (free 30/mês, pro 500, admin 99999) → IA →
`recordAiUsage`. Sem escapatória.

## Banco de dados

- **Source of truth:** `supabase_init.sql` + `migrations/*.sql` (waves numeradas).
  Claude **não roda SQL** — o conteúdo é colado no chat e o usuário executa no
  SQL Editor.
- **RLS** em todas as tabelas mutáveis. Hardening fechado nas Waves 27/32/33
  (`orders`, `messages`, `quotes`, Storage path-validation, `profiles_public` sem
  `portal_access`).
- **RPCs** carregam a lógica pesada: `get_feed_v2`, `search_all` (full-text
  tsvector+GIN), `get_trending_posts`, `boost_post`, `suggest_to_follow`,
  `list_blocked_ids`, `unread_message_count`, `upsert_invoice`, `ai_usage_this_month`.
- **Triggers:** `handle_new_user`, `protect_profile_columns` (anti-escalada
  is_pro/role=admin), `sync_profile_tag_username`, `trg_sync_role_from_user_type`,
  `handle_invoice_paid`, notificações via `pg_net`.
- **Soft delete** (`deleted_at`) + `pg_cron` (cleanups diários/semanais).
- **Tabelas-chave:** `profiles`, `posts`, `comments`, `likes`, `saved_posts`,
  `follows`, `messages`, `notifications`, `products`+`product_variants`,
  `orders`+`invoices`, `quotes`, `jobs`, `points`, `blocks`, `reports`,
  `media_hash_blocklist`+`media_review_queue`, `push_subscriptions`,
  `consent_log`+`audit_log`.

## Auth & autorização

- **Auth:** Supabase email/senha; sessão em `localStorage`; `AuthProvider` expõe
  `user`, `session`, `emailVerified`.
- **Verificação de email (C6):** bloqueia publicar/comentar/DM no client + banner.
- **Age gate (C5):** `MIN_AGE=16` no signup, revalidado server-side.
- **3 níveis de autorização:**
  1. **RLS** (banco) — fonte de verdade.
  2. **`policies.ts`** — RBAC/ownership puro no client (só esconde UI).
  3. **Server gates** — `requireAdminServer()` (cookie httpOnly), `requirePro()`,
     `gateAiUsage()` (fail-closed em prod).

## Pagamentos (multiplataforma)

`lib/services/billing-platform.ts` detecta o ambiente (web / wrapper iOS / wrapper
Android) e roteia o checkout:
- **Web** → Mercado Pago (Checkout PRO assinatura + loja one-shot), webhook
  HMAC-SHA256 fail-closed, idempotência via `upsert_invoice`, anti-fraude.
- **iOS** → StoreKit (`apple-iap-verify`) — stub gated por
  `IAP_PRODUCTION_VERIFICATION_ENABLED`.
- **Android** → Play Billing (`play-billing-verify`) — idem stub.

## Realtime, IA, observabilidade, PWA

- **Realtime:** canais Supabase filtrados por `user_id` (chat, notificações, jobs,
  points) via `useGlobalRealtime`/`useChatRealtime`.
- **IA:** OpenAI↔Gemini fallback; assistentes Seu Zé/Fé/Senna/Alice; moderação
  multimodal Gemini + blocklist de hash (CSAM).
- **Observabilidade:** Sentry (browser tracing, Web Vitals RUM `tracesSampleRate:1.0`,
  breadcrumbs do feed) + tabela `errors` + `/admin/errors`.
- **PWA/mobile:** Service Worker, Web Push (VAPID ES256 + aes128gcm, zero-dep),
  Capacitor iOS scaffold, Android TWA.

## Deploy & CI

- **Prod:** push `main` → auto-deploy Cloudflare Pages → `queroumacor.com.br`.
- **Preview:** branch ≠ `main` → `<branch-slug>.queroumacorapp.pages.dev` + banner
  🧪 STAGING + `X-Robots-Tag: noindex`.
- **Build:** `next build` → `@cloudflare/next-on-pages` → `.vercel/output/static`.
- **Headers:** CSP rígida, HSTS preload submetido, cache imutável pra assets versionados.
- **CI:** typecheck (`tsc --noEmit`) + lint + `vitest run`.

## Diagrama de fluxo (texto)

```
[Browser] GET /
   ▼
[Cloudflare Pages CDN] serve HTML/RSC + _headers (CSP/HSTS)
   ▼
[Next.js App Router]
   │  RSC renderiza shell; Client Components hidratam
   │  Providers: AuthProvider → QueryProvider → DialogProvider
   ▼
[AuthProvider] restaura sessão Supabase (localStorage) → user
   ▼
[Hook (TanStack Query)] → [Service] → getSupabase()
   ▼
[Supabase PostgREST / RPC] com RLS (anon|authenticated)
   │  Realtime channels (chat/notifications)
   ▼
[Render] DOM + modais (BottomSheet)

[Ações server-side]
   ▼
[Route handler app/api/X] → lib/api/X
   │  requireAdminServer / requirePro / gateAiUsage
   │  _ai.ts (OpenAI ↔ Gemini)  | service-role pra ops privilegiadas
   ▼
[JSON] → client reconcilia cache
```

## Dívida / pontos de atenção

- Itens externos pendentes pra produção: `MP_WEBHOOK_SECRET` no CF Pages, opt-in
  do Cloudflare CSAM Scanning Tool, popular `product_variants` (4171 SKUs), PDF do
  orçamento (stub), "estimar por foto" da calculadora (não wireado).
- Verificação real de IAP (StoreKit/Play) ainda é stub — só habilitar quando
  publicar nas lojas.
