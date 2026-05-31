# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
Versionamento: [SemVer](https://semver.org/lang/pt-BR/)

Para roadmap pendente ver [BACKLOG.md](./BACKLOG.md). Para action items
do usuário (DNS, CF Pages setup) ver [USER_ACTIONS.md](./USER_ACTIONS.md).
Arquitetura atual em [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## [Unreleased] — Path C (Next.js cutover)

### Added

- `next-app/` — scaffold Next.js 15 + TypeScript strict + Tailwind v4
  + App Router (Phase 1, commits `a6913e9` / `2452dfe`).
- 44 features portadas em paralelo (Phase 2 a 7): signup multi-step,
  notificações, pedidos, leads, profile-edit, quals/cursos, archive,
  formacao, pipeline, CRM, agenda, financeiro, marketplace, camisetas,
  arte IG, ai-logo, audio STT, feed completo (timeline + stories +
  interactions + composer), chat 1:1 + 3-way Cali Colors.
- 28 endpoints backend portados (Phase 9.1 a 9.3): admin/auth/chat
  service, payments (`checkout`, `mp-checkout-loja`, `mp-webhook`).
- 694 testes verdes em `next-app/`, TS strict 0 errors.
- 5 test suites portadas (`db.ts`, `errors.ts`, `policies.ts`,
  `schemas.ts`, `utils.ts`) com 119 testes em TypeScript estrito.
- `lib/db.ts` — port TS strict de `db.js` (324 linhas).
- `schemas.ts` — 13 schemas Zod port shape-compatível.
- Cloudflare KV cache para `/api/cidades` (binding `KV`, TTL 7d).
- TanStack Query + React Hook Form + AuthProvider no next-app.
- Sentry `@sentry/nextjs` (client + server + edge) no next-app.
- Database types do Supabase em TS gerados estaticamente.

### Changed

- Vanilla: `validators.js` → `schemas/*` (regras de shape estilo Zod,
  chainable via `.optional()` e `.refine()`).
- Vanilla: HSTS preload submetido — header `_headers` agora
  `max-age=31536000; includeSubDomains; preload`.
- KV binding ativo (`queroumacorapp-cidades`), cache cidades IBGE 7d TTL.

### Fixed

- 17 ESLint errors zerados (cross-IIFE references) — commit `daa8329`.
- TDZ bugs em `currentMode`, `storyGroups`, `_lastFeedLoad`,
  `_searchNewChatUsersImpl` etc. — commit `043896a`.
- `_origShowScreen` ReferenceError em produção (login bloqueado) —
  commit `df2c1cf`.
- `ig-art` photo2 omitido no fallback Gemini (segunda foto sumia da
  composição antes/depois).
- 2 últimos dead debounce wrappers (`mktSearch` +
  `filterExplorePainters`) — commit `7ec91ea`.
- `pagehide`/`visibilitychange` listeners movidos pra
  `modules/chat.js` (commit `490c222`).

### Security

- HSTS preload submetido (`max-age=31536000; includeSubDomains;
  preload`), na fila do Chromium pra preload list (~6-12 semanas).
- ESLint gate no CI bloqueando referências mortas cross-IIFE.

---

## [1.0.0] — 2026-05-31 — Path A vanilla 100% (estável)

Marco da arquitetura vanilla pronta pra cutover ou suporte estendido.
Estado: feature-complete, 142 testes verdes, ESLint 0 errors, 44
módulos extraídos. Detalhes em [ARCHITECTURE.md](./ARCHITECTURE.md).

### Added — Modularização (Fase 4)

- **Fase 4 etapa 1** — 44 módulos IIFE extraídos de `app.js` para
  `modules/*.js`. Cada módulo registra `window.Modules.X` e expõe sua
  superfície via `shims.js`. Detalhes em commits `1a4df87` / `41961fb`.
- **Fase 4 etapa 2** — 338 funções migradas de `app.js` para módulos;
  `app.js` caiu de 9176 → 1299 linhas (-86%). 85 testes unitários
  cobrem o que migrou. Commits `580edf8` / `e4fabc2`.
- **Fase 4 etapa 2 cleanup** — 112 state vars encapsuladas em
  `modules/*` (commit `c23c686`).
- **Sentry integrado** — loader script no app principal + portal
  admin, CSP ampliada para `*.sentry.io` em `connect-src`. Code
  Mappings GitHub configurados, Performance + Session Replay ativos.
- **E2E Playwright** + workflow `rollback.yml` + `CONVENTIONS.md` —
  commit `3d4a7d7`.

### Added — Foundation libs

- `errors.js` / `logger.js` / `policies.js` — RBAC + ownership puro,
  sem rede (commit `af1f1e9`).
- `config.js` — constantes centralizadas (commit `5bee8f4`).
- `utils.js` — 21 helpers puros copiados (commit `bafe345`).
- `events.js` — event bus desacoplado (commit `5e93fff`).
- `_layers/` — índice nominal Clean Architecture com READMEs apontando
  para arquivos reais (resolve A5 sem mover código).
- ADRs `docs/adr/0001` a `0005` (commits `2a342c6`, `a0a2d02`).

### Added — Backend / observabilidade

- `/api/health` — endpoint pra uptime monitoring (commit `cc538c8`).
- `/api/log-error` — recebe `window.onerror`, `unhandledrejection` e
  Web Vitals; grava em tabela `errors` no Supabase (commit `d1ef7d8`).
- Dashboard `/admin/errors` — substituto caseiro de Sentry, gateado
  por `_isAdmin` (commit `2daead2`).
- `/api/me-export` — export LGPD (dados do próprio usuário).
- KV cache em `/api/cidades` (proxy IBGE, TTL 7d).

### Added — Features funcionais

- Carrinho de loja persistente (`profiles.cart`).
- Checklist de obra persistente (tabela `checklists`).
- Raio de atendimento persistente (`profiles.service_radius`).
- Conversas arquivadas persistentes (`profiles.archived_conversations`).
- Stories vistos persistentes (`profiles.seen_stories`).
- Contador de logo IA persistente (`profiles.ai_logo_gen_count`).
- Anotações (`notes`) + sininho de notificações (`notifications`)
  com RLS e realtime.
- Cores de produto preenchidas por IA (`products.color_hex`).
- Indicações: tabela `referrals` + triggers
  `award_referral_points` / `recalc_painter_rating`.
- Arte pra Instagram (PRO): bucket `style-refs` + 3 estilos
  visuais por template; OpenAI gpt-image-1 primário + Gemini fallback.
- Seu Zé (assistente IA do orçamento) com voz (STT/TTS).
- Mercado Pago checkout (PRO subscription + loja) + webhook validado.
- Camisetas com logo customizado.
- Marketplace de produtos + filtros + busca + cart.
- Pipeline kanban com `pricing-suggest` IA.
- CRM "Reativar Clientes" com `crm-draft` IA + WhatsApp link.
- Agenda calendário com `agenda-order` IA.
- Financeiro entries + `fin-analysis` IA.
- AI-logo gerador + apply + save.
- `area-from-photo` — cálculo de área via foto.
- `resolve-color` — IA pra resolver dicionário de cores.

### Changed — Performance

- Feed: render progressivo + cache stale-while-revalidate
  (commit `54a3c77`).
- Stories: skip re-render idêntico (commit `405c882`).
- Chat: localStorage debounced + WS realtime deferido.
- Video: preload `metadata`, joins server-side, SELECTs enxutos.
- Lazy-load jspdf, leaflet, remove turnstile dead code.
- Paraleliza queries de perfil e cache mais longo de `followingIds`.
- `cfImg()` helper roteando avatares/feed/stories/produto pelo
  Cloudflare Image Resizing (allowlist Supabase Storage).

### Fixed

- Recovery vai pra `/update-password` (não feed) — sem feed atrás
  do modal.
- Avatar quebrado no feed (desliga CF Image Resizing pra origens
  não habilitadas).
- Story viewer fallback de mídia/avatar sem depender do CF.
- Follow state consistente entre lista e perfil.
- Botão "Seguindo" reflete estado real do banco.
- `appConfirm`/`appPrompt`/`appAlert` definidos (estavam undefined
  em produção, bloqueando "gerar logo").
- Avatares SVG inline (corta dep `ui-avatars.com`).
- Auto-hospeda fonte Syne (logo caía em sans-serif genérica).
- Header limpo + logo clicável pro feed.
- Removido FAB "+" sobrepondo tiles do perfil.
- Itens detalhados de orçamento com garantia/prazo editáveis.
- Categoria de Vonixx/Metalatex/Novacor corrigida na loja.
- Gerador de código resiliente + filtros responsivos.

### Security

- **SQL Wave 3 hardening** (commit `0fbf79b`): trigger
  `protect_profile_columns` BEFORE INSERT/UPDATE impede escalada de
  `is_pro`/`portal_access`/`role=admin`; UNIQUE em
  `points(source, reference_id)` anti double-credit; policies SELECT
  restritas a `authenticated` em `follows`/`likes`/`comments`/etc.;
  view `announcements_public` esconde `created_by`; deny-all em
  `rate_limits`.
- **SQL Wave 4** (commit `8fa344e`): tabelas `reports` e
  `feature_interest` criadas, fixa erros silenciosos do `submitReport`
  e `abrirMaquininha`.
- Self-host de Supabase JS, jsPDF, Babel, Leaflet e React
  (corta dependência de CDN externo).
- CSP rigorosa (`script-src` sem `'unsafe-eval'`, allowlist por host).
- COOP/CORP headers (`Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`).
- Fail-closed em `gateProAI` + rate-limit admin/export + sanitize
  errors + UF whitelist.
- LGPD compliance: DPO em `_security.js`, operadores nominais,
  verificação idade 18+, `me-export.js`.
- `apiPost` envia token só em header (não no body) + dedupe-submit.
- Rate limit defensivo no login/signup/reset por IP (commit `ce12db5`).
- Pre-compile Babel JSX do portal (drop -2.6 MB de payload de
  produção).
- Coluna `profiles.birth_date` + DPO email no signup.

### Infrastructure

- **CI workflow** (commit `f8fe691`): `node -c` em cada `.js`,
  asset reference check (catches `?v=` apontando pra path inexistente),
  Vitest com `--passWithNoTests`.
- **Dependabot** (commit `85d0f63`): npm weekly + github-actions
  weekly, dev-deps agrupadas.
- **Staging via preview deploys** (commit `2a58434`): banner amarelo
  `STAGING - <hostname>` quando rodando fora de `queroumacor.com.br`.
- **Wait+notify pós-deploy** registrado em `CLAUDE.md` (commit
  `f6e4245`).
- **API versioning** implícito v1 (commit `bd520a2`).
- **Rollback workflow** com `confirm=ROLLBACK` (commit `3d4a7d7`).
- **Uptime monitoring workflow** (commit `476f8b1`).

### SEO + a11y

- canonical + OG completo + JSON-LD + preconnects + h2 fix + lazy img
  + noscript + toast no signup.
- robots.txt + sitemap.xml + no-cache em index.html.
- Google Search Console verificado via DNS TXT + meta tag.
- a11y: modal foco + toast + nav button + labels + landmarks +
  autocomplete + role dialog em portal.

---

## [0.x] — histórico pré-modularização

Estado anterior ao trabalho de Fase 4: `app.js` monolítico de ~9100
linhas, sem módulos, sem CI, sem foundation libs. Commits relevantes
preservados via `git log` (não detalhados aqui).

### Fase 3 — camada de dados

- `db.js` (`window.DB`) extraído de `app.js` (commit `4fbaf7b`).
- Phase 1 — `follows` migrado para `DB.follows.*` (commit `a829e3c`).
- Phase 2 — `profiles` migrado para `DB.profiles.*` (commit `61eaee5`).
- Phase 3 — `posts`/`stories` migrado para `DB.posts.*`
  (commit `3d1c723`).

### Wave 2 / 3 / 4 / 5 (auditoria de segurança e UX)

- Wave 2: a11y + PWA + LGPD consent + export UI (commit `a9541bd`).
- Wave 3: security hardening — frontend/backend/portal/DB (commit
  `207885f`).
- Wave 4: SEO + perf + UX + code quality + observability prep
  (commit `4000b71`).
- Wave 5: Babel pre-compile portal + observability + History API
  (commit `2c42614`).

---

## Convenções deste changelog

- **Datas**: ISO 8601 (`YYYY-MM-DD`).
- **Tipos de mudança**: `Added`, `Changed`, `Deprecated`, `Removed`,
  `Fixed`, `Security`, `Infrastructure`.
- **Cache-bust bump** (mudança em `app.js`/`head.js`/`modules/*`)
  não vira entrada — é overhead operacional, não user-facing.
- **Merges sem feature** (force redeploys, cherry-picks de merge
  duplicados) são omitidos. Source de verdade é o git log.
- **SQL waves** são listadas em `Security` ou `Added` + referência
  cruzada em `CLAUDE.md` (não pedir pra rodar de novo).
