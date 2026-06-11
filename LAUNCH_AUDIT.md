# LAUNCH AUDIT — QueroUmaCor

**Data:** 2026-06-10
**Escopo:** Production-readiness completa (20 áreas).
**Metodologia:** 6 sub-auditorias paralelas (rotas+fluxos, vanilla legado, DB/RLS, Functions/AI/MP, security/LGPD, build/PWA/TS). Análise estática do código — onde não dá pra verificar, marca "Needs manual test".

---

## 0. EXECUTIVE SUMMARY

**Estado geral:** **7/10 — quase pronto pra lançar, com 3 blockers críticos.**

O port Next.js está **funcionalmente completo** (52 rotas production-ready), com infra de IA sólida (14 features com gate+record sem escapatória), pagamentos Mercado Pago hardenizados (idempotência, anti-fraude, signature HMAC), e RLS coberta na maioria das tabelas.

**Mas:**

1. **🔴 O app vanilla legado (44 módulos / 10.8K linhas) ainda roda em paralelo ao Next** em produção. 12+ features estão duplicadas, com cache divergente, double-realtime, e risco real de "topo Next + conteúdo vanilla" em cascata CSS. Isso é o blocker estrutural mais sério.
2. **🔴 3 buracos de RLS sérios**: `orders` (INSERT frouxa permite criar order pra outro user), `messages` (UPDATE policy ausente, soft delete quebra), `quotes` (SELECT público expõe PII de leads).
3. **🔴 Storage `posts` e `avatars` sem validação de path** — possível path traversal pra escrever em pasta de outro user.

Tudo o resto (LGPD operacional, ESLint quebrado, 2 service workers, Next SW não registrado, env vars consolidação) é médio/baixo, contornável após o lançamento se o time aceitar.

### Recomendação

**Não lançar pra público geral** até resolver os 3 blockers acima (estimo 1-2 semanas focadas). **Lançar pra beta fechada** (whitelist de testers) já é possível — a infra core funciona.

---

## 1. WHAT IS PRODUCTION-READY

### Backend / Infraestrutura
- ✅ **Autenticação** (Supabase Auth, signup com invite codes, password reset, rate limiting via `/api/auth-rate-check`)
- ✅ **14 features de IA** com `gateAiUsage` + `recordAiUsage` (free 30/mês, pro 500/mês, admin 99999) — nenhuma escapatória
- ✅ **Mercado Pago Checkout PRO** (assinatura) e **Loja** (one-shot) — anti-tampering server-side, idempotência via `upsert_invoice` RPC, trigger `handle_invoice_paid` atualiza profile
- ✅ **Mercado Pago Webhook** com validação HMAC-SHA256 (timing-safe), anti-fraude (re-busca payment no MP), retorna 200 em erros não-fatais (anti-retry-storm)
- ✅ **Realtime** filtered por user_id em jobs/points/notifications/messages — sem N+1 evidente
- ✅ **Soft delete** (Wave 8) em posts/comments/notes/quotes/checklists com cleanup_soft_deleted() RPC
- ✅ **Admin gating duplo** (ADMIN_EMAILS env + RLS `is_portal_admin()` SQL function)
- ✅ **Sentry** ligado (releases, breadcrumbs feed, Web Vitals RUM ativo)
- ✅ **HSTS preload submetido** (queroumacor.com.br na fila Chromium)
- ✅ **CSP headers** apertados (challenges.cloudflare.com, *.sentry.io, *.supabase.co)
- ✅ **TypeScript** com 0 erros (`tsc --noEmit` clean)
- ✅ **Tests** 823/823 passing (62 test files)

### Rotas Next (Production-ready, 52 total)

**Auth/Onboarding:** `/`, `/login`, `/signup`, `/reset-password`, `/update-password`

**Feed/Social:** `/feed`, `/post/[id]`, `/explore`, `/search`, `/hashtag/[tag]`, `/notificacoes`

**Profile:** `/perfil`, `/perfil/[id]`, `/perfil/editar`, `/perfil/publico`, `/perfil/formacao`, `/perfil/grafites` (AR Grafite Sprint 1+2), `/perfil/bloqueados`

**Profissional (PRO + role gates):** `/orcamentos` (Kanban), `/orcamento-ia`, `/agenda`, `/financeiro`, `/crm`, `/checklist`, `/calculadora`, `/leads`, `/notes`, `/seu-ze`, `/fe`, `/senna`, `/arte-ig`, `/ai-logo`

**Cliente:** `/alice` (IA designer)

**Loja:** `/loja`, `/loja/[id]`, `/loja/carrinho`, `/pedidos`, `/camisetas`

**Chat:** `/chat`, `/chat/[convId]`

**Pontos/PRO:** `/pontos`, `/pro`

**Info/LGPD:** `/info`, `/info/ajuda`, `/info/privacidade`, `/info/termos`, `/info/sobre`

**Admin:** `/admin/products`, `/admin/products/[id]`, `/admin/reports`, `/admin/feature-interest`

---

## 2. WHAT IS PARTIALLY WORKING

### 🟡 Loja — variantes
- Wave 25 SQL ok, UI do seletor renderiza quando há variants, mas **0 dos 4171 SKUs têm variants populadas**. Frontend cai pro `products.price` (sem regressão visual) mas seletor nunca aparece em prod.
- Decisão pendente: o user pediu pra gerar 3 variantes padrão pra todos via SQL bulk (regra ÷14/÷4/×1) — SQL pronto na conversa, aguardando execução.

### 🟡 Calculadora — "Estimar por foto"
- Botão menciona área-from-photo API mas integração frontend não wireada. Backend pronto (gateAiUsage), só falta swap no input file.

### 🟡 Orçamento IA — PDF
- pricing-suggest API existe e funciona, mas geração final do PDF marcada como stub (lib de PDF não integrada). Form ok, AI texto ok, download PDF pendente.

### 🟡 LGPD operacional
- `consent_log` tabela criada, RLS pronta, mas **não há INSERT automático no signup** (linha "Estou ciente" no SignupStep3 não grava). Tabela provavelmente vazia.
- `audit_log` e `audit_events` populando, mas **sem cron de retenção** — vai acumular indefinidamente.
- `cleanup_soft_deleted` e `cleanup_orphan_media` funções existem mas **sem cron**.

### 🟡 Exclusão de conta LGPD
- Hoje é **manual via WhatsApp** (`loja@calicolors.com.br`). Não há endpoint `/api/delete-account`. Prazo LGPD de 15 dias úteis depende de operação humana.

### 🟡 Financeiro + Calculadora — paywall só visual
- `canSeeProFeature` esconde UI mas **dados em memory/localStorage**, sem endpoint server-side. Não é exploração real (não persiste), mas é paywall fraco. Aceitar como design ou criar endpoints.

---

## 3. WHAT IS ONLY UI / MOCK

### Camisetas
- 4 cores de camiseta hardcoded em `lib/services/mkt.ts` (sem tabela `shirts` no DB). Mockup `/shirt-mockup.png` estático. Carrinho persiste em `profiles.cart` (vai pra checkout normal). Funcional, mas catálogo fixo.

### "Arte pra Venda" (grafiteiro)
- Database table existe mas **não há sync de inventário ou order separado** — feature sketched, não conectada ao checkout real. Aparece como tile mas o fluxo de compra/entrega não está fechado.

### TODOs documentados (não-bloqueantes)
- `next-app/scripts/generate-openapi.ts:8` — gerador OpenAPI YAML manual
- `next-app/app/calculadora/page.tsx:4` — area-from-photo TODO
- `next-app/lib/services/mkt.ts:128, 212` — shirts mock + placeholder colors

**Nenhum botão com `onClick={}` vazio. Nenhum form com submit stub. Nenhum loading infinito.**

---

## 4. CRITICAL BLOCKERS BEFORE LAUNCH 🔴

### B1 — Vanilla legado ainda em produção paralelo
**Severidade:** Crítica estrutural.
**Detalhe:** 44 módulos vanilla (10.8K linhas) + 20 screens via `showScreen()` carregam EM PARALELO com Next.js. 12+ features duplicadas (feed, chat, mkt, profile, pipeline, stories, orçamento, notificações, etc.). Resultado:
- **8+ realtime channels redundantes** (vanilla `_feedSub`+`_chatSub`+`_notifSub`+`_pipelineSub` + Next useGlobalRealtime equivalentes)
- **Cache divergence**: vanilla `feedCache_v3_*` em localStorage vs Next TanStack Query
- **Ações em uma versão não refletem na outra** (like no vanilla, Next vê stale; vice-versa)
- **2 service workers** competindo (vanilla `/sw.js` v13 vs Next `/next-app/public/sw.js` v1)
- **shims.js** ainda load-bearing — 325 `onclick="..."` inline no HTML dependem dele

**Fix:**
- Decidir: matar vanilla 100% (preferido) OU consolidar shims em 1 backend só.
- Sprint focado em deletar `modules/feed.js`, `modules/chat.js`, `modules/mkt.js`, `modules/profile-edit.js`, etc.
- Remover refs no `index.html` + atualizar `_redirects` pra sempre cair no Next.

### B2 — RLS frouxa em `orders`
**Severidade:** Crítica security.
**Detalhe:**
```sql
-- Atual em supabase_init.sql:
CREATE POLICY "..." ON public.orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "..." ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
```
**User A pode `INSERT INTO orders (user_id: B, total: 99999)`.** Sem `auth.uid() = user_id` no WITH CHECK.

**Fix SQL:**
```sql
DROP POLICY IF EXISTS "Users can create own orders" ON public.orders;
CREATE POLICY "Users can create own orders" ON public.orders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can update orders" ON public.orders;
CREATE POLICY "Users can update own orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### B3 — `messages` UPDATE policy ausente + soft delete vazando
**Severidade:** Crítica funcional + privacy.
**Detalhe:**
- Wave 8 adicionou `deleted_at` em messages, mas nenhuma UPDATE policy. Código em `chat-messages.softDeleteMessage()` faz `UPDATE` sem RLS — falha silenciosamente.
- `SELECT` policy NÃO filtra `deleted_at IS NULL` — **mensagens "apagadas" continuam visíveis pros 2 lados** até cleanup_soft_deleted rodar.

**Fix SQL:**
```sql
-- 1. UPDATE policy pra soft-delete funcionar
CREATE POLICY "messages_soft_delete_own" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- 2. SELECT filtra soft-deleted
DROP POLICY IF EXISTS "Users see own conversations" ON public.messages;
CREATE POLICY "Users see own conversations" ON public.messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (sender_id = auth.uid() OR receiver_id = auth.uid())
  );
```

### B4 — `quotes` SELECT público expõe PII
**Severidade:** Crítica LGPD.
**Detalhe:** `CREATE POLICY ... ON quotes FOR SELECT USING (true)` — qualquer authenticated user enxerga TODAS as quotes, que contêm `address`, `client_name`, `client_phone`. Scraping de leads + violação LGPD direto.

**Fix SQL:**
```sql
DROP POLICY IF EXISTS "Quotes are viewable by everyone" ON public.quotes;
CREATE POLICY "Quotes viewable by participants only" ON public.quotes
  FOR SELECT TO authenticated USING (
    client_id = auth.uid()
    OR painter_id = auth.uid()
    OR public.is_portal_admin()
  );
```

### B5 — Storage `posts` e `avatars` sem path validation
**Severidade:** Crítica security (path traversal).
**Detalhe:** Bucket policy de INSERT é `WITH CHECK (bucket_id = 'posts')` — **qualquer authenticated user pode escrever em qualquer path do bucket**, inclusive sobrescrever arquivos de outro user se conseguir advinhar UUIDs.

**Fix SQL:**
```sql
DROP POLICY IF EXISTS "Users can upload to posts" ON storage.objects;
CREATE POLICY "Posts owner write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can upload to avatars" ON storage.objects;
CREATE POLICY "Avatars owner write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );
```
(Repetir pra UPDATE/DELETE em ambos.)

---

## 5. MEDIUM-PRIORITY FIXES 🟡

### M1 — `MP_WEBHOOK_SECRET` em fail-open mode
Webhook hoje aceita signed e unsigned. Setar `MP_WEBHOOK_ENFORCE=true` em CF Pages env após popular `MP_WEBHOOK_SECRET`. Sem isso, atacante pode forjar webhook.

### M2 — Consent log não populado
Tabela existe, RLS pronta, mas **nenhum INSERT do frontend no signup**. Adicionar em `SignupStep3` quando user clica "Estou ciente":
```ts
await supabase.from('consent_log').insert({
  user_id: user.id,
  consent_type: ['terms', 'privacy'],
  consent_version: 'v1',
  consent_given: true,
});
```

### M3 — Endpoint `/api/delete-account` LGPD
Hoje exclusão é manual via WhatsApp (não cumpre prazo 15 dias úteis automaticamente). Criar endpoint que:
- Marca `profiles.deleted_at`
- Cascade soft-delete em posts/messages/comments/quotes/art_references (já temos Wave 8)
- Anonimiza email/phone/birth_date/address
- Loga em `audit_log` com action='lgpd.account_deletion'

### M4 — Cron jobs faltantes
3 funções de cleanup criadas mas SEM agendamento (pg_cron):
- `cleanup_old_audit_log()` — > 1 ano
- `cleanup_soft_deleted()` — > 30 dias
- `execute_cleanup_orphan_media()` — > 7 dias

Configurar pg_cron no Supabase: `SELECT cron.schedule('cleanup-audit', '0 3 * * *', 'SELECT cleanup_old_audit_log()')`.

### M5 — Types do Supabase desatualizados
5+ tabelas criadas pós-init.sql não estão em `database.types.ts`: `invoices`, `ai_usage`, `plan_limits`, `consent_log`, `audit_log`, `invite_codes`, `product_variants`, `art_references`, `reports`, `feature_interest`, `blocks`. Código usa cast manual (`as unknown as`). Solução: rodar `supabase gen types typescript` e commitar.

Também: coluna `messages.read_at` (Wave 24) não está nos types.

### M6 — Bug no filtro de visibilidade Seu Zé
`BusinessGrid.tsx:228`:
```ts
if (t.sheet === 'seu-ze') {
  return showAdmin || userRole === 'pintor' || (!userRole && userRole !== 'cliente');
}
```
A condição `!userRole && userRole !== 'cliente'` é tautológica (se !userRole, segunda é sempre true). Provavelmente quis `userRole === 'pintor' || !userRole`. Verificar intenção.

### M7 — Rota `/alice` sem gate de role
User não-cliente pode digitar `/alice` na URL e a página carrega (sem 403). Adicionar redirect ou erro pra non-cliente.

### M8 — ESLint quebrado
`es-abstract/2024` faltando, `next lint` não roda. Workaround: disabled no build. Fix: `rm -rf node_modules package-lock.json && npm install` em `/next-app/`, ou migrar pra eslint.config.js flat.

### M9 — `comments` realtime invalida globalmente
`useGlobalRealtime` invalida `post-comments|*` em qualquer INSERT — N+1 em scale. Filtrar por `post_id` específico.

### M10 — `JSON.parse(JSON.stringify(next))` em ChecklistView
Linha 56, sem try/catch. Trocar por `structuredClone(next)`.

---

## 6. NICE-TO-HAVE IMPROVEMENTS

- N1: Pre-commit hooks (.husky) com lint + typecheck
- N2: Consolidar 2 lockfiles (root + next-app) em 1
- N3: Unificar service workers (atual: vanilla v13 ativo, Next v1 dormindo)
- N4: Cache version sync entre vanilla SW e Next SW
- N5: `NEXT_PUBLIC_APP_VERSION` semver pra health endpoint reportar build real
- N6: Limpar 21 `eslint-disable` (legítimos mas pode ser doc'd em uma rule)
- N7: Botão admin "Auto-gerar variantes pra todos os produtos"
- N8: Remover `functions/api/*.js` legacy (Next API é fonte de verdade)
- N9: DMARC em `calicolors.com.br` (DNS pendente do user)
- N10: Cron pra invalidar SW antigo (push `?v=` bump automático)

---

## 7. ROUTE-BY-ROUTE STATUS

| Rota | Status | Quem vê | Observação |
|---|---|---|---|
| `/` | ✅ ready | público | Redirect auth-aware |
| `/login` | ✅ ready | público | Rate limit OK |
| `/signup` | ✅ ready | público | Multi-step, invite codes |
| `/reset-password` | ✅ ready | público | |
| `/update-password` | ✅ ready | auth | |
| `/feed` | ✅ ready | auth | get_feed_v2 RPC + fallback legacy |
| `/post/[id]` | ✅ ready | auth | fetchPostById |
| `/explore` | ✅ ready | auth | Trending RPC |
| `/search` | ✅ ready | auth | search_all FTS RPC |
| `/hashtag/[tag]` | ✅ ready | auth | ILIKE caption |
| `/notificacoes` | ✅ ready | auth | Realtime |
| `/perfil` | ✅ ready | auth | BusinessGrid |
| `/perfil/[id]` | ✅ ready | público | UUID ou @tag |
| `/perfil/editar` | ✅ ready | auth | Zod validation |
| `/perfil/publico` | ✅ ready | auth | Preview |
| `/perfil/formacao` | ✅ ready | auth | |
| `/perfil/grafites` | ✅ ready | role gate | AR Sprint 1+2 (Wave 26) |
| `/perfil/bloqueados` | ✅ ready | auth | |
| `/loja` | 🟡 partial | público | Variants criadas mas não populadas |
| `/loja/[id]` | ✅ ready | público | |
| `/loja/carrinho` | ✅ ready | auth | MP checkout |
| `/pedidos` | ✅ ready | auth | |
| `/orcamentos` | ✅ ready | PRO + role | Kanban |
| `/orcamento-ia` | 🟡 partial | PRO | PDF generation stub |
| `/agenda` | ✅ ready | PRO + role | |
| `/financeiro` | 🟡 partial | PRO | Client-side only |
| `/crm` | ✅ ready | PRO + role | gateProAI |
| `/checklist` | ✅ ready | auth | |
| `/calculadora` | 🟡 partial | auth | area-from-photo TODO |
| `/leads` | ✅ ready | auth | Spec ambígua: PRO ou free? |
| `/notes` | ✅ ready | auth | |
| `/chat` | ✅ ready | auth | Realtime + unread |
| `/chat/[convId]` | ✅ ready | auth | mark-as-read (Wave 24) |
| `/seu-ze` | ✅ ready | PRO + role | gateProAI |
| `/fe` | ✅ ready | PRO + grafiteiro | |
| `/senna` | ✅ ready | PRO + automotivo | |
| `/alice` | 🟡 partial | cliente | Direct URL: sem gate, sem 403 |
| `/arte-ig` | ✅ ready | PRO + free 5/dia | |
| `/ai-logo` | ✅ ready | PRO + free 1 | |
| `/camisetas` | 🟡 mock | auth | Catálogo hardcoded |
| `/publicar` | ✅ ready | auth | Composer |
| `/pro` | ✅ ready | auth | MP checkout |
| `/pontos` | ✅ ready | auth | exchange_points_for_pro |
| `/info` | ✅ ready | público | |
| `/info/ajuda` | ✅ ready | público | |
| `/info/privacidade` | ✅ ready | público | Cali Colors CNPJ |
| `/info/termos` | ✅ ready | público | |
| `/info/sobre` | ✅ ready | público | |
| `/admin/products` | ✅ ready | admin | Wave 25 |
| `/admin/products/[id]` | ✅ ready | admin | |
| `/admin/reports` | ✅ ready | admin | Wave 18 |
| `/admin/feature-interest` | ✅ ready | admin | Wave 19 |
| `/admin/flags` | 🔍 manual test | admin | Não auditado |
| `/admin/errors` | ❌ não portado | admin | Só no portal vanilla |

---

## 8. FEATURE-BY-FEATURE STATUS

| Feature | Frontend | Backend | RLS | Gate | Status |
|---|---|---|---|---|---|
| Auth (signup/login) | ✅ | ✅ Supabase | ✅ | n/a | ready |
| Feed | ✅ Next + 🔴 vanilla duplicado | ✅ get_feed_v2 | ✅ | n/a | duplication risk |
| Post create | ✅ | ✅ | ✅ | n/a | ready |
| Like/Comment/Save | ✅ | ✅ | ✅ | n/a | ready |
| Stories | ✅ + duplicado vanilla | ✅ | ✅ | n/a | duplication risk |
| Search | ✅ | ✅ search_all RPC | ✅ | n/a | ready |
| Trending (Explore) | ✅ | ✅ get_trending_posts | ✅ | n/a | ready |
| Hashtags | ✅ | ✅ ILIKE | ✅ | n/a | ready |
| Notifications | ✅ + duplicado | ✅ realtime | ✅ | n/a | duplication risk |
| Chat | ✅ + 🔴 duplicado vanilla | ✅ | 🔴 UPDATE missing | n/a | **B3 blocker** |
| Unread badge | ✅ Wave 24 | ✅ | ✅ | n/a | ready |
| Profile view/edit | ✅ + duplicado | ✅ | ✅ | n/a | ready |
| Follow/Block | ✅ | ✅ | ✅ | n/a | ready |
| Verified badge | ✅ Wave 20-23 | ✅ | ✅ | admin sets | ready |
| Boost post | ✅ | ✅ Wave 22 | ✅ | PRO | ready |
| Soft delete + undo | ✅ Wave 8 | ✅ | 🔴 messages | n/a | partial (msg) |
| Reports | ✅ admin | ✅ Wave 18 | ✅ | admin | ready |
| Loja produtos | ✅ + duplicado | ✅ | ✅ | n/a | ready |
| Loja variantes | ✅ Wave 25 | ✅ | ✅ | admin gerencia | 🟡 não populadas |
| Carrinho | ✅ | ✅ profiles.cart | ✅ | n/a | ready |
| Checkout MP loja | ✅ | ✅ | 🔴 orders | n/a | **B2 blocker** |
| Pedidos | ✅ + duplicado | ✅ | ✅ | n/a | ready |
| Camisetas | ✅ | mock | n/a | n/a | mock catalog |
| Pontos | ✅ + duplicado | ✅ | ✅ | n/a | ready |
| PRO checkout | ✅ | ✅ Wave 7 | ✅ | n/a | ready |
| PRO grace period | ✅ | ✅ is_pro_active | n/a | n/a | ready |
| AI chat (Seu Zé/Fê/Senna/Alice) | ✅ | ✅ | n/a | PRO + role | ready |
| AI 14 features | ✅ | ✅ gateAiUsage | n/a | PRO | ready |
| Logo IA | ✅ | ✅ | n/a | PRO | ready |
| Arte pra IG | ✅ | ✅ ig-art + style-refs | ✅ | PRO/free | ready |
| Orçamento IA | ✅ | 🟡 PDF stub | ✅ | PRO | partial |
| CRM Reativar | ✅ | ✅ crm-draft | ✅ | PRO | ready |
| Agenda | ✅ + duplicado | ✅ | ✅ | PRO | ready |
| Financeiro | 🟡 client-only | n/a | n/a | PRO visual | partial |
| Calculadora | 🟡 calc ok, photo TODO | ✅ partial | n/a | n/a | partial |
| Checklist | ✅ + duplicado | ✅ | ✅ | n/a | ready |
| Notas | ✅ + duplicado | ✅ | ✅ | n/a | ready |
| Quotes pipeline | ✅ + duplicado | ✅ | 🔴 SELECT pub | PRO | **B4 blocker** |
| Leads | ✅ | ✅ | ✅ | open (spec) | ready |
| Reviews (avaliação) | ❌ vanilla only | ✅ | ✅ | n/a | not ported |
| Maquininha | ❌ vanilla only | feature_interest | ✅ | n/a | not ported |
| Arte pra Venda | 🟡 UI partial | n/a | n/a | grafiteiro | mock |
| AR Grafite | ✅ Wave 26 Sprint 2 | ✅ storage | ✅ | role | ready |
| LGPD consent | ✅ tabela | ❌ INSERT manual | ✅ | n/a | gap |
| LGPD delete account | ❌ WhatsApp manual | ❌ | n/a | n/a | gap |
| Admin moderation | ✅ Wave 18 | ✅ | ✅ | admin | ready |
| Admin products | ✅ Wave 25 | ✅ | ✅ | admin | ready |
| Admin flags | 🔍 not tested | ✅ | ✅ | admin | manual test |
| Admin feature interest | ✅ Wave 19 | ✅ | ✅ | admin | ready |

---

## 9. DATABASE / RLS CHECKLIST

| Tabela | RLS SELECT | INSERT | UPDATE | DELETE | Risco |
|---|---|---|---|---|---|
| profiles | ✅ public read | ✅ trigger | ✅ owner+protect_columns | ✗ deny default ok | OK |
| posts | ✅ approved + active | ✅ owner | ✅ owner | ✅ owner+admin | OK |
| comments | ✅ active + owner+admin | ✅ owner | ✅ owner | ✅ owner+admin | OK |
| **messages** | 🔴 não filtra deleted_at | ✅ sender | 🔴 **POLICY AUSENTE** | ✅ soft via UPDATE | **B3** |
| likes | ✅ public | ✅ owner | n/a | ✅ owner | OK |
| saved_posts | ✅ owner | ✅ owner | ✅ owner | ✅ owner | OK |
| **orders** | ✅ owner+admin | 🔴 **WITH CHECK (true)** | 🔴 **WITH CHECK (true)** | ✗ | **B2** |
| **quotes** | 🔴 **public USING (true)** | ✅ client_id | ✅ client+painter | ✗ | **B4** |
| jobs | ✅ owner | ✅ owner | ✅ owner | ✗ | OK (painter-only) |
| invoices | ✅ owner | ✗ service_role | ✗ | ✗ | OK |
| ai_usage | ✅ owner | ✗ service_role | ✗ | ✗ | OK |
| notifications | ✅ owner | ✅ trigger | ✅ owner | ✗ | OK |
| points | ✅ owner | ✅ trigger | ✗ | ✗ | OK |
| reports | ✅ admin | ✅ owner | ✅ admin | ✗ | OK |
| product_variants | ✅ public | ✅ admin | ✅ admin | ✅ admin | OK |
| art_references | ✅ owner | ✅ owner | ✅ owner | ✅ owner | OK |
| blocks | ✅ owner | ✅ owner | ✗ | ✅ owner | OK |
| follows | ✅ public | ✅ owner | ✗ | ✅ owner | OK |
| reviews | ✅ public | ✅ owner | ✗ | ✗ | OK (append-only) |
| consent_log | ✅ owner | ✅ owner | ✅ owner | ✗ | OK |
| audit_log | ✅ admin | ✗ service | ✗ | ✗ | OK |
| checklists | ✅ owner | ✅ owner | ✅ owner | ✅ soft | OK |
| notes | ✅ owner | ✅ owner | ✅ owner | ✅ soft | OK |
| storage.posts | ✅ public | 🔴 **bucket_id only** | 🔴 | 🔴 | **B5** |
| storage.avatars | ✅ public | 🔴 **bucket_id only** | 🔴 | 🔴 | **B5** |
| storage.art-refs | ✅ public | ✅ split_part match | ✅ | ✅ | OK |
| storage.style-refs | ✅ public | ✅ service_role | ✅ | ✅ | OK |

---

## 10. CLOUDFLARE FUNCTIONS CHECKLIST

29 functions em `/functions/api/*.js` — **TODAS portadas pra Next** em `/next-app/app/api/**/route.ts`.

**Frontend chama Next (path relativo). Functions `.js` antigas são fallback inativo.** Recomendação: deletar após 1-2 sprints (reduzir surface area).

| Function | Path | Status |
|---|---|---|
| chat-ai | /api/chat-ai | ✅ portado |
| caption | /api/caption | ✅ portado |
| transcribe | /api/transcribe | ✅ portado |
| tts | /api/tts | ✅ portado |
| generate-logo | /api/generate-logo | ✅ portado |
| area-from-photo | /api/area-from-photo | ✅ portado |
| pricing-suggest | /api/pricing-suggest | ✅ portado |
| fin-analysis | /api/fin-analysis | ✅ portado |
| crm-draft | /api/crm-draft | ✅ portado |
| agenda-order | /api/agenda-order | ✅ portado |
| resolve-color | /api/resolve-color | ✅ portado |
| moderate | /api/moderate | ✅ portado |
| moderate-video | /api/moderate-video | ✅ portado |
| ig-art | /api/ig-art | ✅ portado |
| checkout | /api/checkout | ✅ portado |
| mp-checkout-loja | /api/mp-checkout-loja | ✅ portado |
| mp-webhook | /api/mp-webhook | ✅ portado |
| health | /api/health | ✅ portado |
| log-error | /api/log-error | ✅ portado |
| cidades | /api/cidades | ✅ portado |
| me-export | /api/me-export | ✅ portado (LGPD Art. 18 V) |
| admin-users | /api/admin/users | ✅ portado |
| admin-moderate | /api/admin/moderate | ✅ portado |
| admin-errors-list | /api/admin/errors-list | ✅ portado |
| upload-style-ref | /api/upload-style-ref | ✅ portado |
| ig-art-diag | /api/ig-art-diag | ✅ portado |
| auth-rate-check | /api/auth-rate-check | ✅ portado |

---

## 11. AI CHECKLIST

14 features de IA. **Todas com gate + record completo. Nenhuma escapatória de billing.**

| Feature | Provider | Gate PRO | Rate/min | Mensal record | Status |
|---|---|---|---|---|---|
| chat-ai (Seu Zé/Fê/Senna/Alice) | OpenAI \| Gemini | gateProAI | 20 | recordAiUsage | ✅ |
| caption | OpenAI | gateProAIForm | 10 | ✅ | ✅ |
| transcribe (áudio) | OpenAI | gateProAIForm | 10 | ✅ | ✅ |
| tts (voz) | OpenAI | gateProAI | 10 | ✅ | ✅ |
| generate-logo | OpenAI | gateProAI | 3 | ✅ | ✅ |
| area-from-photo | OpenAI | gateProAIForm | n/a | ✅ | ✅ |
| pricing-suggest | OpenAI | gateProAI | n/a | ✅ | ✅ |
| fin-analysis | OpenAI | gateProAI | 5 | ✅ | ✅ |
| crm-draft | OpenAI \| Gemini | gateProAI | n/a | ✅ | ✅ |
| agenda-order | OpenAI \| Gemini | gateProAI | n/a | ✅ | ✅ |
| resolve-color | OpenAI \| Gemini | gateProAI | 30 | ✅ | ✅ |
| moderate (texto) | OpenAI \| Gemini | gateProAI | n/a | ✅ | ✅ |
| moderate-video | OpenAI | gateProAI | n/a | ✅ | ✅ |
| ig-art | OpenAI + fallback Gemini | gateProAI | 5 | ✅ + style-refs bucket | ✅ |

**Limites por plano (Wave 7):** free=30/mês, pro=500/mês, admin=99999/mês. Grace period 3 dias via `pro_grace_until`.

---

## 12. MERCADO PAGO CHECKLIST

### Checkout PRO (assinatura R$ 39/mês)
- File: `lib/api/_services/checkout.ts`
- Fluxo: frontend → preapproval MP → init_point → user paga → webhook → `is_pro=true` + `pro_expires_at=now+33d`
- ✅ JWT validation antes de criar preapproval
- ✅ Origin hardcoded (anti Host header forge)

### Checkout Loja (one-shot)
- File: `lib/api/_services/mp-checkout-loja.ts`
- ✅ Re-busca produtos server-side com service_role (anti-tampering)
- ✅ Re-monta items + valida total
- ✅ Corrige `orders.total` no DB se cliente forjou
- ✅ Marca order com gateway='mp' + payment_url

### Webhook
- File: `lib/api/_services/mp-webhook.ts`
- ✅ Validação HMAC-SHA256 com timing-safe-equal
- ✅ Idempotência por `external_id` (UNIQUE)
- ✅ Anti-fraude (re-busca payment no MP como fonte da verdade)
- ✅ Anti-retry-storm (200 em todos erros não-fatais)
- ✅ Trigger `handle_invoice_paid` propaga pro profile
- 🟡 **`MP_WEBHOOK_SECRET` opcional** — atual em fail-open. Setar `MP_WEBHOOK_ENFORCE=true` após popular secret (M1).

### Env vars necessárias
- `MP_ACCESS_TOKEN` ✅ configurada
- `MP_WEBHOOK_SECRET` 🟡 setar
- `MP_WEBHOOK_ENFORCE=true` 🟡 setar após acima

---

## 13. MOBILE / PWA CHECKLIST

### Service Worker
- 🔴 **2 SWs ativos** (vanilla `/sw.js` v13 + Next `/next-app/public/sw.js` v1)
- Vanilla registrado em `index.html:2693`
- Next SW arquivo EXISTE mas NÃO registrado em `layout.tsx` — dormindo
- Cache strategies divergentes (vanilla = cache-first p/ `?v=*`, Next = LRU + stale-while-revalidate)
- Risco: confusão de cache, version bump não sincroniza entre os 2

### Manifest
- ✅ `/next-app/public/manifest.webmanifest` (50 linhas)
- ✅ `display: standalone`, theme `#ff6b35`, ícones 192/512 + maskable
- ✅ `share_target` configurado (GET `/?share=1`)

### Offline
- ✅ `/offline.html` existe
- Vanilla SW fallback ok, Next SW fallback genérico (cache do `/`)

### Notificações push
- ❌ Não implementadas

### Recomendação
- Antes do launch: ESCOLHER 1 SW (vanilla por enquanto, já que Next coexiste com vanilla).
- Não registrar Next SW até vanilla ser deletado.

---

## 14. SECURITY SUMMARY

| Vetor | Status |
|---|---|
| XSS | ✅ renderRichText sem dangerouslySetInnerHTML, escape em URLs |
| CSRF | ✅ Next App Router automático |
| Path traversal storage | 🔴 posts + avatars sem path validation (B5) |
| Open redirect | ✅ URLs locais constructed |
| URL validation (website/IG/story) | ✅ regex https |
| Token leak | ✅ keys em env vars, service_role só server |
| SQL injection | ✅ Supabase SDK parametrizado |
| Privilege escalation profiles | ✅ trigger protect_profile_columns (Wave 3) |
| RLS bypass | 🔴 orders + quotes + messages (B2/B3/B4) |
| Webhook spoofing MP | 🟡 fail-open default (M1) |

---

## 15. LGPD / PRIVACY SUMMARY

| Requisito | Status |
|---|---|
| Política de privacidade pública | ✅ /info/privacidade com CNPJ Cali Colors |
| Termos de uso | ✅ /info/termos |
| Consent log tabela | ✅ Wave 5 |
| Consent log populado | 🔴 INSERT manual ausente no signup (M2) |
| Portabilidade Art. 18 V | ✅ /api/me-export |
| Exclusão Art. 18 VI | 🟡 manual via WhatsApp, sem endpoint (M3) |
| Audit log | ✅ Wave 5 + tabela audit_events |
| Retenção audit log | 🟡 função existe, sem cron (M4) |
| PII em views públicas | ✅ profiles_public exclui email/phone/birth/address |
| Soft delete + cleanup | 🟡 funções existem, sem cron (M4) |
| DPO contact | ✅ loja@calicolors.com.br |

---

## 16. BUILD / DEPLOY SUMMARY

- ✅ Next 15.0 + App Router
- ✅ Deploy via wrangler pages CF Pages, automático no push pra main
- ✅ HSTS preload submetido
- ✅ CSP apertado em `_headers`
- ✅ Image Resizing CF ON (user confirmou)
- ✅ TypeScript clean (0 erros)
- 🔴 ESLint quebrado (es-abstract/2024 missing — disabled in build)
- 🟡 2 lockfiles duplicados
- 🟡 Sem pre-commit hooks
- ✅ CI rodando lint+typecheck+vitest em PRs

---

## 17. ENV VARS CHECKLIST

| Var | Tipo | Configurada? |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | público | ✅ hardcoded fallback |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | público | ✅ |
| NEXT_PUBLIC_SENTRY_DSN | público | ✅ |
| OPENAI_API_KEY | secret | ✅ CLAUDE.md confirma |
| GEMINI_API_KEY | secret | ✅ CLAUDE.md confirma |
| SUPABASE_SERVICE_ROLE | secret | ✅ |
| ADMIN_EMAILS | secret | ✅ |
| MP_ACCESS_TOKEN | secret | ✅ |
| MP_WEBHOOK_SECRET | secret | 🟡 setar |
| MP_WEBHOOK_ENFORCE | secret | 🟡 setar `true` |
| GEMINI_IMG_MODEL | secret | opcional |
| NEXT_PUBLIC_APP_VERSION | público | 🟡 vazio (reporta 'dev') |

---

## 18. FINAL LAUNCH CHECKLIST

### 🔴 Bloqueia launch — fazer antes
- [ ] **B1** Decidir destino do vanilla legado (deletar OU consolidar) — 1-2 semanas
- [ ] **B2** Fix RLS orders (INSERT/UPDATE com `auth.uid() = user_id`)
- [ ] **B3** Adicionar UPDATE policy em messages + filtrar deleted_at no SELECT
- [ ] **B4** Restringir quotes SELECT pra participants + admin
- [ ] **B5** Adicionar path validation em storage posts + avatars

### 🟡 Forte recomendação — fazer antes do GA
- [ ] **M1** Setar `MP_WEBHOOK_SECRET` + `MP_WEBHOOK_ENFORCE=true`
- [ ] **M2** Popular consent_log automaticamente no signup
- [ ] **M3** Endpoint `/api/delete-account` LGPD
- [ ] **M4** Configurar pg_cron pros 3 cleanup jobs
- [ ] **M5** Atualizar database.types.ts (rodar supabase gen types)
- [ ] **M6** Verificar lógica Seu Zé visibility
- [ ] **M7** Gate de role em /alice
- [ ] **M8** Fix ESLint dependency
- [ ] DMARC em calicolors.com.br (DNS GoDaddy)
- [ ] Popular variants pros 4.171 produtos (SQL bulk pronto, aguarda execução)

### 🟢 Pode ir pra depois do launch
- [ ] Pre-commit hooks
- [ ] Consolidar lockfiles
- [ ] Unificar service workers (depois de deletar vanilla)
- [ ] Remover functions/api/*.js legacy
- [ ] Sprint 1.5 (swap fetchFeed legacy fallback)
- [ ] OpenAPI auto-gen
- [ ] PDF do orçamento IA
- [ ] /calculadora "Estimar por foto"

### Manual tests necessários
- [ ] `/admin/flags` (não auditado neste relatório)
- [ ] AR Grafite Sprint 2 em iOS/Android real (gestos pinch+rotate)
- [ ] Webhook MP em prod (1 transação real PRO + 1 loja)
- [ ] Fluxo completo: signup → upload portfolio → recebe orçamento → cobra → recebe payment
- [ ] Dark mode em todas as telas (alguns componentes podem ainda ter `#fff` hardcoded)
- [ ] Mobile real (não emulador) — Image Resizing CF funcionando?

---

## 19. NUMBERS

- **Linhas de código** estimadas: ~50K Next + ~10.8K vanilla legado = 60K+
- **Rotas Next**: 52 production-ready + 5 partial + 1 não-portada
- **Functions/Routes API**: 29 portadas + 29 fallback
- **Tabelas Supabase**: 30+
- **Migrations SQL**: 26 waves
- **Storage buckets**: 4 (posts, avatars, art-refs, style-refs)
- **Tests**: 823 passing (62 files)
- **TypeScript erros**: 0
- **ESLint erros**: corrupted dep (não roda)
- **Sub-auditorias paralelas**: 6
- **Blockers críticos identificados**: 5
- **Médios**: 10
- **Nice-to-have**: 10

---

**Conclusão.** A pilha core do QueroUmaCor está sólida (auth, pagamentos, IA, RLS na maioria, admin). Os 5 blockers são pontuais e endereçáveis em 1-2 semanas focadas. O vanilla legado é o risco estrutural mais sério — não é "bug que dá pra adiar", é fonte de divergência ativa. Pré-launch obrigatório resolver B1-B5.
