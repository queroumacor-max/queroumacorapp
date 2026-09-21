---
tags: [segurança, auditoria, lgpd, privacidade, rls]
---

# Auditoria de Privacidade / LGPD Ponta a Ponta

**Data:** 2026-09-17, PR #359, branch `claude/funny-ramanujan-0zrao0`, mergeada 2026-09-19. SQL `/migrations/2026-09-17-privacy-audit-hardening.sql` — **JÁ EXECUTADO** no Supabase (2026-09-20, confirmado pelo usuário: as 14 linhas de conferência voltaram `ok=true`). **Não pedir pra rodar de novo.**

6 sub-auditorias paralelas: RLS/views/RPC, deleção de conta, fluxos a terceiros, storage local/mobile, logs/admin/moderação, política vs. realidade técnica.

## ACHADO CRÍTICO: `public.profiles` (tabela base) tinha SELECT aberto pra PUBLIC
Confirmado por DUAS sub-auditorias independentes: a tabela BASE (não a view) tinha policy de SELECT `USING (true)` **SEM `TO authenticated`** — valia pra PUBLIC, incluindo `anon`. Qualquer um com a anon key (pública em todo bundle do app) baixava a tabela INTEIRA: email, phone, lat/lng, birth_date, `portal_access` (quem é admin), `is_pro`, `pro_expires_at`, `mp_preapproval_id`, etc. — de TODO usuário, sem login. Isso tornava a `profiles_public` (view curada, criada pra esconder essas colunas) uma **formalidade sem efeito real**.

**FIX**: policy da tabela base virou dono-ou-admin; `profiles_public` foi recriada **de propósito SEM `security_invoker`** (roda com privilégio do criador, então continua projetando o subconjunto seguro de QUALQUER perfil mesmo com a tabela base fechada) — isso reabre o aviso "Security Definer View" do Security Advisor, aceito e documentado como trade-off correto.

## `role='admin'` também vazava
Via `profiles_public`/`get_feed_v2` (reabria o mesmo vazamento que a Wave 32 de 2026-06-12 achava ter fechado removendo só `portal_access`) — `NULLIF(role,'admin')` na view fecha isso.

## Outros fixes desta migration
- `get_feed_v2`/`get_trending_posts` (SECURITY DEFINER, GRANT pra `anon` herdado do modo visitante removido em 2026-06-18) ganharam teto de LIMIT + REVOKE anon, mesmo padrão do `search_all` de 2026-09-13 (ver [[Segurança - Rate Limiting e Abuse]]).
- **Regressão corrigida em `search_all`**: o hardening de 2026-09-13 tinha recriado a função a partir de uma versão mais antiga do corpo, perdendo sem querer as sentinelas anti-XSS do `ts_headline` (CRIT-3) e o match parcial/prefixo por nome — restaurado, mantendo o clamp/revoke. De quebra, passou a filtrar `posts.deleted_at IS NULL` (nunca filtrava antes).
- Push de COMENTÁRIO passou a redigir o texto no corpo do push (mesmo tratamento que `type='message'` já tinha desde 2026-09-15).
- RPC nova `quote_painter_contact(p_quote_id)` substitui a leitura direta de `profiles` que a tela `/orcamentos/[id]` fazia pro cliente ver contato do pintor — dependia da RLS aberta do achado crítico.
- `cleanup_orphan_media()` passou a cobrir os buckets `avatars` e `art-refs` também (antes só `posts`) — foto de perfil de conta deletada ficava pública pra sempre, sem nenhum caminho de limpeza.
- `cleanup_old_errors()` novo (tabela `errors`, 90 dias) + as 3 funções de cleanup que existiam mas nunca tinham sido agendadas (`cleanup_rate_limits`, `cleanup_old_notifications`, `cleanup_old_audit_events`) foram pro pg_cron.
- Trigger novo redige `title`/`body` de notificação quando o AUTOR da ação (quem curtiu/comentou/seguiu) tem a conta deletada depois.

## Nota de reconciliação
Esta migration e a `2026-09-18-final-pentest-hardening.sql` (ver [[Segurança - Pentest Integrado Final]]) recriavam `get_feed_v2` de formas incompatíveis — a versão final reconciliada (IDOR + clamp + sem anon) ficou na do pentest, que roda DEPOIS desta.

---
## Ver também
[[Segurança - Pentest Integrado Final]] · [[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Segurança - Disaster Recovery e Business Continuity]] · [[Auth - OAuth, Cadastro e RLS de Sessão]]
