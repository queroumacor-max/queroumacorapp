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

## Não verificado nesta rodada
Matriz completa 50 tabelas × 4 operações (só sweep de `USING(true)`); Storage buckets além de `whatsapp-media`; Realtime publications além de `whatsapp_messages`; config de Auth (redirect URLs, MFA, captcha) — tudo no Dashboard, MANUAL VERIFICATION.

## Regra de conferência de constraint
**"Verificar que X está desligado" não é o mesmo que "ligar X".** E: conferência de constraint deve **listar** (`pg_constraint` da tabela), não perguntar por nome conhecido — nome só cobre o que você já sabe que existe. (Achado na auditoria do papel "arquiteto": dois CHECKs distintos de role, um corrigido e outro esquecido por essa razão.)

---
## Ver também
[[Segurança - Rate Limiting e Abuse]] · [[Auth - OAuth, Cadastro e RLS de Sessão]] · [[Pendências Reais (Ação Manual Necessária)]]
