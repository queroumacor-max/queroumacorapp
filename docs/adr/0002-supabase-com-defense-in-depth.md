# ADR 0002 — Supabase com defense in depth (RLS + filtros + policies)

- **Status**: Accepted
- **Date**: 2026-05-31
- **Deciders**: mantenedor único
- **Tags**: security, authz, supabase, backend

## Context

Stack do projeto:

- Supabase Postgres + Auth + Storage + Realtime (plano PRO).
- Frontend SPA vanilla JS roda no browser do usuário com
  `supabase-js` UMD. Anon key é pública por design.
- ~25 endpoints serverless em `functions/api/*` rodam em V8 isolates
  (Cloudflare Pages Functions) e podem usar `SUPABASE_SERVICE_ROLE_KEY`
  pra operações privilegiadas.
- Hardening "SQL Wave 3" (26/05) endereçou furos: trigger
  `protect_profile_columns` (impede escalada `is_pro`/`portal_access`/
  `role=admin` via INSERT), UNIQUE `points(source, reference_id)`
  (anti double-credit), policies de SELECT restritas a `authenticated`
  em `follows`/`likes`/`comments`/etc, view `announcements_public` que
  esconde `created_by`.
- Algumas decisões ANTI single-layer aprendidas na auditoria:
  `DB.follows.follow()` faz **verify-after-insert** (SELECT depois do
  INSERT) porque triggers AFTER INSERT em `follows` podem dar
  `ROLLBACK 23505` vindo de OUTRA tabela (ex.: `points`) sem o frontend
  perceber. Confiar só no `.insert()` retornando sem erro é insuficiente.

Pergunta: confiamos só na RLS? Só no client-side filter? Só na policy
pura? Resposta: nenhuma camada sozinha é confiável o bastante.

## Decision

**Defense in depth em 4 camadas, cada uma redundante com a próxima**:

1. **Banco — RLS (fonte da verdade).** Toda tabela mutável pelo client
   tem RLS habilitada. Policies cobrem `SELECT`/`INSERT`/`UPDATE`/
   `DELETE` separadas com `auth.uid() = user_id` ou equivalente. Triggers
   de hardening em colunas sensíveis (`protect_profile_columns`).
   `service_role` bypassa — só usado server-side com auth validada.
2. **Backend — `requireAuth` + `requirePro` + `checkRateLimit`.**
   Endpoints em `functions/api/_security.js` validam JWT antes de
   tocar Supabase com service-role. `requirePro` checa flag depois.
   `checkRateLimit` evita abuso. `requireAuth` é fail-open por design em
   endpoints públicos enquanto a frota legada de clients ainda não envia
   Bearer — RLS no banco ainda barra.
3. **Client — Policies puras (`policies.js`) + filtros `WHERE`.**
   `window.Policies` (`canEditProfile`, `canDeletePost`, `canSeeProFeature`,
   etc.) decide UI antes de fazer a request. Filtros `WHERE` em selects
   evitam vazar campos errados se RLS for permissiva demais. **Não é a
   defesa primária** — UI hide só esconde botão; client filter só evita
   round-trip — mas tornam o sistema mais robusto a bugs.
4. **Verify-after-write em operações críticas.** `DB.follows.follow()`
   faz `SELECT` depois do `INSERT` pra confirmar persistência. Caro? Sim.
   Necessário porque ROLLBACK silencioso via trigger em tabela vizinha
   acontece de verdade no Postgres + Supabase.

`policies.js` é mantido **puro** (sem rede, sem DOM). Testável sem
mocks. RLS é mantida como **fonte da verdade** — se policy pura e RLS
discordarem, RLS ganha.

## Consequences

### Positive

- **Cliente comprometido não vaza dado.** Mesmo se atacante editar JS em
  runtime e remover policies/filters, RLS no banco ainda barra.
- **Bug em uma camada não vira incidente.** Esquecer filtro `WHERE`? RLS
  cobre. Esquecer policy de UI? Botão aparece mas request volta 401/403.
- **Auditável.** `policies.js` é puro e tem teste em
  `tests/policies.test.js`. SQL de RLS está em `supabase_init.sql`
  (~2000 linhas de schema source-of-truth). Hardening tracking em
  `SECURITY_AUDIT_LOG.md`.
- **Trigger silencioso fica explícito.** `verify-after-insert` documenta
  no código que existe `ROLLBACK 23505` cross-table — futuro maintainer
  não precisa redescobrir.
- **Endpoints admin têm gate duplo.** `ADMIN_EMAILS` env var no backend +
  `_isAdmin` setado via `GET /api/admin-moderate?action=check` no
  cliente. Cliente só esconde UI; decisão real é server-side.

### Negative

- **Custo cognitivo.** 4 camadas pra manter sincronizadas. Cada nova
  tabela exige RLS + (talvez) endpoint server + (talvez) método em
  `db.js` + (talvez) policy pura.
- **Risco de drift.** Policy pura permitir algo que RLS bloqueia gera UI
  inconsistente (botão funciona "visualmente" mas request falha).
  Mitigação: convenção de **RLS ganha em caso de conflito**.
- **`requireAuth` fail-open é incômodo.** Decisão de transição enquanto
  frota legada não envia Bearer em todo endpoint. Risco aceito porque
  RLS no banco ainda cobre. Plano: virar fail-closed quando todos os
  call sites estiverem auditados (`BACKLOG.md`).
- **`verify-after-insert` adiciona latência.** Um SELECT extra por
  follow. Aceito porque silent rollback é pior que +1 round-trip.
- **Testes não cobrem RLS de verdade.** Vitest não conecta no Supabase
  real (não tem ambiente local). Cobertura de RLS é via revisão de SQL +
  pen-test manual + monitoramento de Sentry/`/admin/errors`.

## Alternativas consideradas

- **Só RLS, sem policies puras no client.** Mais simples, mas UI vira
  "tente e erre" — usuário clica botão que vai 401. Pior UX. Não.
- **Backend custom (sem service-role, sem RLS) com tudo via
  `functions/api/*`.** Joga fora o produto Supabase Auth/RLS/Realtime.
  Não.
- **Single-tier "Supabase Auth + RLS é suficiente".** É a recomendação
  oficial deles e funcionaria pra 90% dos casos. Não cobre o caso real
  de `ROLLBACK 23505` silencioso nem o caso de UI sem context (mostrar
  ou não o botão "editar"). Por isso adicionamos camadas 3 e 4.
- **OPA / Cedar / outro policy engine externo.** Overkill pro tamanho do
  app. Policies puras em JS resolvem.

## Quando re-avaliar

- Se aparecer um padrão de bug "policy pura diz X, RLS diz Y" recorrente
  — pode justificar gerar policies do schema SQL.
- Se `requireAuth` fail-open virar fail-closed (todos clients legados
  morreram), simplificar essa camada.
- Se Supabase introduzir RLS-as-code do lado client (preview), repensar
  a duplicação.
- Se migrar pra TS, considerar gerar tipos das policies a partir do
  schema pra eliminar drift.

## Referências

- `ARCHITECTURE.md §Autorização`
- `LAYERS.md §4` (cumprimento real auditável)
- `policies.js`, `functions/api/_security.js`, `db.js`
- `supabase_init.sql` (schema + policies source-of-truth)
- `SECURITY_AUDIT_LOG.md` (incluindo SQL Wave 3 hardening)
- ADR 0003 (Cloudflare Functions onde a auth backend roda)
