---
tags: [segurança, auditoria, supabase, rls, postgres]
---

# Auditoria de Segurança do Supabase (RLS, policies, grants, roles, functions, RPCs, triggers, views, Storage, Realtime, Auth, cron, service role)

**Data:** 2026-09-13. SQL `/migrations/2026-09-13-leads-rls-critical.sql` **JÁ EXECUTADO** (2026-09-16, confirmado pelo usuário).

## Achado crítico: `public.leads` nunca teve RLS
Tabela nasceu FORA do repo (sem `CREATE TABLE`, só `ALTER TABLE ... ADD COLUMN`). Varredura de 10.935 linhas de SQL (base + 94 migrations): zero `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`/`GRANT` tocando `leads`. Comparado às outras 50 tabelas do repo — todas têm RLS pelo menos uma vez; `leads` era a única exceção.

- **Impacto**: `leads` guarda ~1072 contatos de prospecção. Sem RLS, qualquer usuário comum ou a chave `anon` lia/escrevia a tabela inteira via REST (`GET /rest/v1/leads?select=*`). O app consumidor não toca essa tabela — é só do portal (sempre admin). Travar pra `is_portal_admin()` não tirou acesso de ninguém real.
- **Autocrítica registrada**: um comentário de correção de performance (mesmo dia) tinha dito "SECURITY INVOKER de propósito: a RLS de `leads` continua valendo" — suposição nunca checada. **Lição: "a RLS de X vale" não é fato até alguém ler a tabela de políticas de X.**

## Falsos positivos confirmados seguros
`products`/`orders`/`announcements`/`commissions` tiveram `USING(true)` no `supabase_init.sql` original, mas foram fechadas pra `is_portal_admin()` num bloco "Re-auditoria Onda 1" já no mesmo arquivo. `profiles_public` (view) perdeu `security_invoker=true` duas vezes e foi corrigida. `exec_sql`/`executar_sql` tiveram EXECUTE revogado e foram DROPadas (`/migrations/2026-06-18-rls-phase3-drop-exec-sql.sql`) — **confirmado removido em produção** (query direta no SQL Editor voltou 0 rows). **100% das 52 funções SECURITY DEFINER do histórico têm `SET search_path`** — sem risco de search-path hijacking. Bucket `whatsapp-media`: privado, só admin lê, escrita só service_role. Trigger `protect_profile_columns` bloqueia auto-promoção a admin. 4 cron jobs sem superfície de injeção. Zero Edge Functions (tudo é rota Next.js no Cloudflare Pages).

## Aceito como risco baixo, não corrigido
`push_device_tokens` UPDATE usa `USING(true) WITH CHECK(auth.uid()=user_id)` de propósito (reatribuição de token físico entre contas). Exploração exigiria adivinhar um UUID que não vaza em nenhum SELECT. **Nota histórica**: isso foi corrigido depois via RPC `upsert_push_device_token` — ver [[Segurança - Firebase FCM e Push]].

## Não verificado nesta rodada (2026-09-13)
Matriz completa 50 tabelas × 4 operações (só sweep de `USING(true)`); Storage buckets além de `whatsapp-media`; Realtime publications além de `whatsapp_messages`; config de Auth (redirect URLs, expiração de JWT, MFA, leaked password protection, captcha) — tudo no Dashboard, MANUAL VERIFICATION REQUIRED; execução real em produção do DROP de `exec_sql`/`executar_sql` (o arquivo existe e está correto, mas não havia como confirmar de dentro do código se rodou).

## Config de Auth do Supabase — verificado via console (2026-09-16, "Claude in Chrome")
Sessão separada, logada como `queroumacor@gmail.com`, checou ao vivo o painel Authentication → Settings, fechando o "MANUAL VERIFICATION" acima:
- **"Confirm email" DESLIGADO** — login sem confirmar e-mail é aceito. Não é regressão: a trava real está no APP (`AuthProvider.emailVerified`), que bloqueia publicar/comentar/mandar mensagem — não o login em si.
- **"Allow anonymous sign-ins" DESLIGADO** — consistente com o modo visitante removido em 2026-06-18.
- **Redirect URLs (3)** escopadas certo, sem wildcard perigoso.
- **Access token**: 3600s de expiração + refresh token rotation + reuse detection, todos ligados.
- **"Prevent use of leaked passwords" LIGADO** (bom).
- **MFA**: TOTP disponível; SMS desligado.
- **Achado — "Enable Captcha protection" DESLIGADO**: mesma lacuna já conhecida como "Bot Fight Mode/Turnstile ausente em `/login`/`/signup`" na borda Cloudflare (ver [[Segurança - Cloudflare]]) — vista agora pelo lado do Supabase Auth. Não é um achado novo, é a MESMA decisão pendente sob outro ângulo — login/signup hoje não têm nenhuma proteção anti-bot.
- `exec_sql`/`executar_sql`: **confirmado removido em produção** nesta mesma rodada — query direta no SQL Editor (`select … from pg_proc where proname ilike '%exec_sql%' or '%executar_sql%'`) voltou **0 rows**. O `/migrations/2026-06-18-rls-phase3-drop-exec-sql.sql` rodou de fato.

## 5 CRITICALs do audit de release fechados (2026-06-12)
Detalhes em `next-app/lib/utils/sanitize.ts`, `next-app/lib/auth-server.ts`, `next-app/lib/api/env-check.ts` e nos commits `22b6dc9`, `91927d2`, `650e7b8`, `047a147`, `948c21a`:
- **CRIT-1 IAP stubs**: `/api/{play-billing,apple-iap}-verify` agora retornam 503 sem `IAP_PRODUCTION_VERIFICATION_ENABLED=true` — antes eram STUBS que aceitavam token sem call ao server do Apple/Google. **NÃO setar essa env** até implementar verificação real (Google Play Developer API + Apple `verifyReceipt`). Detalhe completo em [[Pagamentos, PRO e Compliance Apple]].
- **CRIT-2 MP webhook**: fail-closed em produção sem `MP_WEBHOOK_SECRET` configurado. Rejeição vai pra `audit_log` (`action='mp.webhook.rejected_no_secret'`) — não fica silenciosa.
- **CRIT-3 XSS Search**: `sanitizeSearchSnippet()` no frontend (escape de HTML + as sentinelas `⟦HL_OPEN⟧`/`⟦HL_CLOSE⟧` viram `<b>` só DEPOIS da sanitização). SQL Wave 31 (`search_all` recriada com as sentinelas no `ts_headline`) já executado — defesa em profundidade ativa. Detalhe completo em [[Posts, Stories e Feed]].
- **CRIT-4 Admin RSC auth**: `requireAdminServer()` passou a valer em TODAS as 6 pages `/admin/*` (antes eram Server Components sem checagem própria de sessão). Login grava cookie httpOnly `sb-session-token` via `/api/auth/set-session-cookie` (POST=set, DELETE=clear no signOut). **Efeito colateral operacional**: admins precisam logar UMA VEZ depois do deploy pra gerar o cookie — sessões anteriores ao deploy não habilitam `/admin/*` (caem em 404, não em "acesso negado", o que pode confundir quem não sabe da mudança).
- **CRIT-5 requirePro fail-closed**: `requirePro()` e `gateAiUsage()` em produção sem `SUPABASE_SERVICE_ROLE_KEY` configurada retornam 503 em vez de deixar passar. Boot check `assertProductionEnvs()` — hoje chamado por request nesses dois gates, não mais no module-load (ver [[Mobile - Bugs de WebView e Picker]] pra saber por que rodar no boot causava 500 puro). Detalhe adicional em [[Mobile - Bugs de WebView e Picker]].

## Regra de conferência de constraint
**"Verificar que X está desligado" não é o mesmo que "ligar X".** E: conferência de constraint deve **listar** (`pg_constraint` da tabela), não perguntar por nome conhecido — nome só cobre o que você já sabe que existe. (Achado na auditoria do papel "arquiteto": dois CHECKs distintos de role, um corrigido e outro esquecido por essa razão — `profiles_user_type_check` e `profiles_role_check`, ver [[Auth - OAuth, Cadastro e RLS de Sessão]].)

---
## Ver também
[[Segurança - Rate Limiting e Abuse]] · [[Segurança - Cloudflare]] · [[Auth - OAuth, Cadastro e RLS de Sessão]] · [[Segurança - Auditoria de Privacidade e LGPD]] · [[Segurança - Pentest Integrado Final]] · [[Pendências Reais (Ação Manual Necessária)]]
