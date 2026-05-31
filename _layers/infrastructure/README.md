# Infrastructure — adapters pro mundo externo

> **Esta pasta é um índice nominal.** Os arquivos reais NÃO vivem aqui —
> vivem em `/db.js`, `/head.js`, `/functions/api/_*.js`, etc. Ver
> [`_layers/README.md`](../README.md) pra contexto.

## O que é Infrastructure neste projeto

**Adapters** pra coisas externas: banco de dados (Supabase), HTTP
(fetch / apiPost / fetch externo), auth (JWT), log (console + Sentry +
tabela `errors`), config (env vars), browser APIs (`localStorage`,
Service Worker, `navigator.*`), e provedores de IA (OpenAI/Gemini).

Esconde detalhes de implementação atrás de fachadas. Application
chama essas fachadas sem saber se por baixo é Supabase, Postgres direto
ou um mock.

## Arquivos reais que cumprem Infrastructure

### Client-side

| Arquivo | Responsabilidade |
|---|---|
| [`/db.js`](../../db.js) | Fachada `window.DB` sobre Supabase. `DB.profiles.getById/getMany`, `DB.follows.follow/unfollow/isFollowing/listFollowingIds`, `DB.posts.getFeedPosts/getByUser`. Esconde verify-after-insert (bug 23505 do trigger). |
| [`/head.js`](../../head.js) | Boot + auth + helpers fetch. `getSupabase()` (lazy singleton), `currentUser` (fonte da verdade), `apiPost` (fetch + Bearer JWT), `withTimeout`, `safeAwait`, `cfImg`, `brl`, `dateBR`, `avatarUrl`. (Mistura cross-cutting + boot — ver §5 violações em `LAYERS.md`.) |
| [`/logger.js`](../../logger.js) | Log helpers (`window.Logger`). Encapsula `console.*` + envio pra `/api/log-error`. |
| [`/config.js`](../../config.js) | Constantes cross-cutting (`window.Config`). |
| [`/sw.js`](../../sw.js) | Service Worker. Cache de assets, fallback offline, lifecycle PWA. |
| [`/supabase.js`](../../supabase.js) | UMD do supabase-js (SRI travado). Apenas a lib — não código nosso. |

### Server-side — `/functions/api/_*.js`

| Arquivo | Responsabilidade |
|---|---|
| [`/functions/api/_security.js`](../../functions/api/_security.js) | `getToken`, `getTokenFromForm`, `requireAuth`, `requirePro`, `checkRateLimit`, `gateProAI`, `ServiceError`. Validação JWT Supabase + rate-limit em KV. Fail-open por design em endpoints públicos. |
| [`/functions/api/_ai.js`](../../functions/api/_ai.js) | Adapter unificado OpenAI ↔ Gemini com fallback. Application chama `callAI({ model, messages })` sem saber qual provider. |
| [`/functions/api/_services/cidades.js`](../../functions/api/_services/cidades.js) | Adapter IBGE + cache em KV. (A parte HTTP de fala com IBGE é infra; a forma de filtrar/rankear cidades é application.) |

### Auth/storage adapters embutidos

- Supabase Auth (em `head.js`): `localStorage` é a persistência default.
- Realtime channels: `getSupabase().channel(...)` — adapter da própria lib.
- Storage `posts`, `style-refs`: chamados via `getSupabase().storage.from()`.

## Regras

- **Domain NÃO depende daqui.** `policies.js`, `schemas/`, `errors.js`
  não importam `getSupabase`, `apiPost`, nem chamam `fetch`. Grep valida.
- **Application DEPENDE daqui.** Módulos em `/modules/*.js` e endpoints
  em `/functions/api/*.js` chamam estes adapters.
- **Infrastructure NÃO depende de Application.** `db.js` não pode
  chamar `loadFeed` nem `syncQuotesToJobs`. Adapter não conhece
  features de cima.

Verificação:

```sh
# db.js / head.js NÃO devem importar de modules/
grep -nE "Modules\\.[A-Z]" db.js head.js logger.js config.js
# → DEVE retornar zero matches (ou só comentários).
```

## Violações conhecidas

`head.js` mistura infra (`getSupabase`, `apiPost`) com use case
(`loadMyProfileData`) e cross-cutting (`brl`, `dateBR`, `avatarUrl`).
**Aceito** porque boot precisa rodar antes de tudo. Plano: mover o que
for puro pra `utils.js` e o que for use case pra `modules/profile-edit.js`.
Ver `LAYERS.md §5`.

## Migração futura

- `db.js` → `lib/db.ts` ou interface `IDB` com `class SupabaseDB
  implements IDB`. A fachada já existe — só formalizar tipo.
- `head.js` → split em `lib/supabase.ts` + `lib/auth.ts` + provider React.
- `_security.js` → middleware Next.js (`middleware.ts`) + lib helpers.
- `_ai.js` → mantém forma de adapter, só ganha tipos.
