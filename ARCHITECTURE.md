# Arquitetura — QueroUmaCor

> Estado **atual** da arquitetura (não o ideal, não o futuro). Para o plano
> de modularização ver `ARCHITECTURE_PLAN.md`. Para workflow de preview ver
> `STAGING.md`. Para convenções e SQL já rodado ver `CLAUDE.md`.

## Stack

- **Hosting**: Cloudflare Pages (plano PRO) — entrega de estáticos + Pages
  Functions (V8 isolates) para o backend.
- **Banco**: Supabase Postgres (plano PRO) + Auth + Storage + Realtime + RLS.
- **Frontend**: vanilla JS (sem framework), HTML + CSS estáticos. PWA com
  Service Worker e manifest.
- **Portal admin**: React 18 (UMD) + Babel standalone em `/portal`, JSX
  inline no navegador (sem build).
- **IA**: OpenAI + Gemini com fallback automático (`functions/api/_ai.js`).
- **Testes**: Vitest.
- **CI**: GitHub Actions (`ci.yml` em qualquer branch ≠ main; `deploy.yml` em
  push para `main`).

## Estrutura do repo

- `index.html` — SPA principal, ~2300 linhas. Todas as telas em `div.screen`.
- `app.js` — lógica residual da SPA (~1300 linhas pós-Fase 4 etapa 2 —
  reduzido de ~9100 linhas; sobra state vars, boot one-shots e helpers
  exclusivos. Funções de feature vivem em `modules/`).
- `modules/` — 44 módulos IIFE (`window.Modules.X`), cada um cobre uma
  feature isolada (feed, chat, mkt, agenda, ranking, ai-chat, etc.).
- `shims.js` — ponte `window.Modules.X.fn → window.fn` (+ `window.Utils.X
  → window.X`) pra que HTML inline handlers (onclick="...") e bare calls
  legados continuem funcionando. Carrega ANTES do `app.js`.
- `head.js` — boot, auth, helpers de fetch, observabilidade, perfil.
- `db.js` — fachada `window.DB` sobre Supabase (profiles/follows/posts).
- `schemas/` (`_core.js`, `primitives.js`, `documents.js`, `social.js`,
  `index.js`) — `window.Schemas` (regras de validação shape estilo Zod;
  `parse(v) → { ok, value?, error?:{code,message} }`, chainable via
  `.optional()` e `.refine(fn,msg)`).
- `policies.js` — `window.Policies` (RBAC + ownership puro, sem rede).
- `utils.js` — `window.Utils` (helpers puros: parseBRL, toast, escapeHtml,
  getTimeAgo, etc.). Re-exportado como globals via `shims.js`.
- `errors.js` / `logger.js` / `types.js` — helpers globais.
- `styles.css` — único arquivo de CSS.
- `supabase.js`, `jspdf.umd.min.js`, `leaflet.js/css` — libs self-hosted (SRI).
- `sw.js`, `manifest.json`, `offline.html` — PWA.
- `_headers`, `_redirects` — config Cloudflare Pages.
- `robots.txt`, `sitemap.xml` — SEO.
- `supabase_init.sql` — source-of-truth do schema (~2000 linhas).
- `functions/api/` — backend (Cloudflare Pages Functions, ~25 endpoints).
- `portal/` — admin React (`app.jsx` + Babel) servido em `/portal`.
- `fonts/` — Syne self-hosted (woff2).
- `img/`, `products/`, `style-refs/` — assets estáticos.
- `tests/` — Vitest.
- `scripts/build-portal.js` — script de build do portal.
- `.github/workflows/` — `ci.yml` + `deploy.yml`.
- `CLAUDE.md`, `STAGING.md`, `ARCHITECTURE_PLAN.md`, `BACKLOG.md`,
  `SECURITY_AUDIT_LOG.md` — docs.

## Frontend

Scripts carregados em `index.html` via `<script defer>`, nesta ordem
(execução respeitando ordem de declaração porque defer é serial):

1. `supabase.js` — UMD do supabase-js (SRI travado).
2. `head.js` — define `getSupabase()`, `currentUser`, `apiPost`, auth,
   `loadMyProfileData`, helpers (`brl`, `dateBR`, `avatarUrl`, `cfImg`,
   `gateProClient`, `withTimeout`, `safeAwait`, `withErrorHandling`).
3. `config.js` / `utils.js` / `errors.js` / `logger.js` / `policies.js` /
   `db.js` / `schemas/*` — camadas fundacionais. Expostas em
   `window.Config`, `window.Utils`, `window.Errors`, `window.Schemas`, etc.
4. `modules/*.js` (44 arquivos, ~10000 linhas) — features encapsuladas em
   IIFE. Cada módulo registra `window.Modules.X = { ... }`.
5. `shims.js` — republica `Modules.X.fn` e `Utils.X` como bare globals em
   `window` pra HTML inline handlers (onclick) e código legado seguirem
   funcionando. **Roda ANTES de `app.js`** pra que boot calls em app.js
   (`_bootstrapFromUrl()`, `_consumeInviteFromUrl()`, `updateCartBadge()`)
   já tenham as window.* wireadas.
6. `app.js` — agora ~1300 linhas: state vars residuais, boot one-shots
   (`_injectSheetCloseButtons`), `getAccessToken` (helper auth), e
   comentários sentinela apontando pra cada feature que migrou.

Padrão de modal: `.sheet` (overlay clicável → painel). Cache offline via
`sw.js`. Sem bundler; tudo é global em `window`.

### Por que IIFE + shim em vez de ES modules?

ES modules quebrariam HTML inline handlers (`onclick="loadFeed()"`) — esses
exigem que a função esteja em `window`. Refatorar todos os inline handlers
pra `addEventListener` ia ser uma 2ª onda de risco. O padrão IIFE + shim
mantém a mesma superfície (window globals) com encapsulamento por módulo
e abre caminho pra migração futura (ESM ou bundler) sem big-bang.

## Backend (`/functions/api/`)

Cloudflare Pages Functions em ESM. Cada `X.js` vira a rota `/api/X`.
Arquivos com prefixo `_` (`_security.js`, `_ai.js`) são módulos privados,
não roteáveis.

- `_security.js` — `getToken`, `getTokenFromForm`, `requireAuth`,
  `requirePro`, `checkRateLimit`, `gateProAI` (fail-open por design quando
  config incompleta).
- `_ai.js` — wrapper OpenAI ↔ Gemini com fallback.
- `health.js` — uptime monitor.
- `log-error.js` — recebe erros do client + Web Vitals e grava em `errors`.
- `chat-ai.js` — Seu Zé (assistente IA do orçamento).
- `caption.js`, `transcribe.js`, `tts.js` — captions, STT, TTS.
- `moderate.js`, `moderate-video.js` — moderação de conteúdo.
- `admin-moderate.js`, `admin-users.js`, `admin-errors-list.js` — endpoints
  admin (`ADMIN_EMAILS`).
- `auth-rate-check.js` — rate limit pré-login.
- `agenda-order.js`, `crm-draft.js`, `fin-analysis.js`,
  `pricing-suggest.js`, `area-from-photo.js`, `resolve-color.js` — IAs por
  feature (pipeline, CRM, financeiro, calc, cor).
- `generate-logo.js`, `ig-art.js`, `ig-art-diag.js`,
  `upload-style-ref.js` — logo e Arte pra Instagram.
- `checkout.js`, `mp-checkout-loja.js`, `mp-webhook.js` — Mercado Pago
  (PRO + loja).
- `cidades.js` — autocomplete de cidades.
- `me-export.js` — export LGPD (dados do próprio usuário).

## Camada de dados

- `db.js` (`window.DB`) é a forma centralizada de **ler** `profiles`,
  `follows` e `posts` a partir de `head.js`/`app.js`. Restante do app ainda
  usa `sb.from('X')` direto.
- **Escritas** (insert/update/delete) seguem indo direto via
  `sb.from('X')` na maioria dos call sites — `DB.follows.follow/unfollow`
  é exceção.
- `DB.follows.follow()` faz **verify-after-insert** (SELECT após INSERT)
  porque triggers AFTER INSERT em `follows` podem dar `ROLLBACK 23505`
  vindo de OUTRA tabela (ex.: `points`) sem que o frontend perceba.
- `fetchPublicProfiles()` (em `app.js`) é reaproveitada por `DB.profiles.getMany`
  — único ponto que sabe do fallback `profiles_public → profiles`.
- View `profiles_public` esconde colunas sensíveis e projeta `tag` e
  `username` como sinônimos (trigger `sync_profile_tag_username`).

## Autenticação

- Supabase Auth com email/senha.
- Sessão persistida em `localStorage` (default supabase-js).
- Tela própria `update-password` para fluxo de recovery (link via email).
- `_security.requireAuth()` valida JWT no backend. **Fail-open por design**
  em endpoints públicos (deixa passar sem token enquanto a frota de clients
  legados ainda não envia Bearer).
- `currentUser` é uma global em `head.js` — fonte da verdade no client.

## Autorização

- **RLS no Supabase** em todas as tabelas mutáveis pelo client. Hardening
  "SQL Wave 3" já aplicado (trigger `protect_profile_columns` impede
  escalada de `is_pro`/`portal_access`/`role=admin`; UNIQUE em
  `points(source, reference_id)` evita double-credit; SELECT restrito a
  `authenticated` em `follows`/`likes`/`comments`/etc.).
- `ADMIN_EMAILS` (env var Cloudflare) gateia endpoints admin no backend.
- `_isAdmin` no client é setado via `GET /api/admin-moderate?action=check`
  (não dá pra confiar — só esconde UI). Decisão real é server-side.
- `policies.js` (`window.Policies`) — RBAC + ownership central, puro, sem
  rede. `canEditProfile`, `canDeletePost`, `canEditQuote`,
  `canModerateContent`, `canSeeProFeature`, `canFollowUser`, etc.
  Migração gradual a partir de `_isAdmin`/`_isPro` espalhados pelo app.

## Observabilidade

- `POST /api/log-error` recebe erros do client (`window.onerror`,
  `unhandledrejection`) + Web Vitals (LCP, FID, CLS).
- Tabela `errors` no Supabase guarda histórico.
- Modal `/admin/errors` no app (gate `_isAdmin`) lista os últimos erros.
- `GET /api/health` para uptime monitor externo.

## Deploy

- **Produção**: push em `main` → `deploy.yml` + auto-deploy Cloudflare Pages
  → `queroumacor.com.br`.
- **Preview**: push em qualquer branch ≠ `main` → preview deploy automático
  em `<branch-slug>.queroumacorapp.pages.dev`. Banner amarelo
  `🧪 STAGING · <hostname>` aparece quando host ≠ `queroumacor.com.br`.
  `X-Robots-Tag: noindex` automático nos `*.pages.dev`.
- **Sem build step** — o repo é servido como está. Exceção: `build:portal`
  pré-compila o JSX do portal admin.
- **Cache-busting**: `index.html` carrega `head.js`, `db.js`, `schemas/*`
  e `app.js` com `?v=AAAAMMDD<letra>` (ex.: `?v=20260531d`). **DEVE ser
  bumpado** sempre que o arquivo muda — senão Cloudflare serve a versão
  antiga do cache.
- `_redirects`: `/portal/*` → `/portal/index.html`, `/api/*` → `/api/:splat`,
  `/*` → `/index.html` (SPA fallback 200).
- `_headers`: CSP rigorosa, HSTS 12 meses (sem `preload` ainda — flag em
  07/07/2026 segundo `SECURITY_AUDIT_LOG.md`), cache imutável para assets
  versionados.

## Testes

- `npm test` → `vitest run` (sem watch).
- `tests/_security.test.js` — `getToken`, `getTokenFromForm` e contratos
  do helper de auth.
- `tests/schemas.test.js` — 13 schemas (email, senha, match, tag,
  CPF/CNPJ etc.) + helpers chainable (`.optional()`, `.refine()`).
- `tests/db.test.js` — smoke do shape de `window.DB` + caminho degradado
  (sem Supabase → tudo retorna seguro).
- **Sem teste de UI/E2E**. Smoke manual por feature após cada mudança
  (preview em staging).
- CI (`ci.yml`) também roda `node -c` em cada `.js` e valida que cada path
  com `?v=` referenciado em `index.html` existe no disco.

## Diagrama de fluxo (texto)

```
[Browser]
   │  GET /
   ▼
[Cloudflare Pages CDN]
   │  serve index.html + _headers (CSP/HSTS) + _redirects (SPA)
   ▼
[Browser parseia index.html]
   │  <script defer> em ordem:
   │   1. supabase.js (UMD)
   │   2. head.js     (auth, currentUser, apiPost, getSupabase)
   │   3. db.js       (window.DB)
   │   4. schemas/* (window.Schemas)
   │   5. app.js      (features + showScreen)
   ▼
[head.js boot]
   │  Supabase Auth restore (localStorage) → currentUser
   │  loadMyProfileData() → profiles row
   ▼
[app.js showScreen('feed')]
   │  loadFeed() → DB.posts.getFeedPosts() + DB.follows.listFollowingIds()
   ▼
[Supabase REST/PostgREST]
   │  RLS aplicada (anon ou authenticated)
   │  Realtime channels pra chat/notifications
   ▼
[Render] → DOM atualizado, modais via .sheet pattern

[Ações server-side via apiPost('/api/X', body)]
   │
   ▼
[Cloudflare Pages Functions /functions/api/X.js]
   │  _security.requireAuth(request, body) → valida JWT
   │  _security.checkRateLimit() / requirePro() conforme endpoint
   │  _ai.js → OpenAI ↔ Gemini fallback (endpoints de IA)
   │  Supabase service-role pra operações privilegiadas
   ▼
[JSON response] → client atualiza UI
```
