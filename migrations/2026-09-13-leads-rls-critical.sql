-- ============================================================================
-- 2026-09-13 — Auditoria de segurança do Supabase (RLS/policies/grants).
--
-- ACHADO CRÍTICO: `public.leads` NUNCA teve RLS habilitada por nenhuma
-- migration deste repositório.
--
-- Evidência (não suposição): a tabela `leads` nasceu FORA do repo — não
-- existe `CREATE TABLE public.leads` em `supabase_init.sql` nem em nenhuma
-- das 94 migrations (só `ALTER TABLE public.leads ADD COLUMN ...`, 7 vezes,
-- pra abordagem/opt-out/Instagram). Uma varredura completa do histórico de
-- SQL (10.935 linhas, base + todas as migrations em ordem) não encontra
-- NENHUM `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY` nem `GRANT`/`REVOKE`
-- tocando essa tabela — em nenhum ponto da história deste repositório.
-- Comparar com QUALQUER outra tabela criada aqui: todas as 50 passam por
-- `ENABLE ROW LEVEL SECURITY` pelo menos uma vez. `leads` é a única exceção,
-- e ninguém tratou isso porque a tabela nunca apareceu numa migration —
-- não tinha "gancho" óbvio pra alguém lembrar de proteger.
--
-- IMPACTO: `leads` guarda ~1072 contatos de prospecção (nome, telefone,
-- categoria, segmento, cidade, status, e-mail/Instagram quando existe) —
-- dado de negócio da Cali Colors, não do usuário do app. Sem RLS, QUALQUER
-- role com privilégio de tabela no schema `public` (o padrão do Supabase é
-- `anon`/`authenticated` terem GRANT amplo — é a RLS que restringe linha a
-- linha) consegue ler/escrever a tabela INTEIRA direto pela API REST do
-- Supabase, sem passar pelo portal nem por `is_portal_admin()`:
--   GET https://<projeto>.supabase.co/rest/v1/leads?select=*
-- com a chave anon (pública, em qualquer bundle) ou o token de QUALQUER
-- usuário comum do app (pintor, cliente — não precisa ser admin). Essa
-- rota nunca foi usada pelo app consumidor (conferido: `next-app/lib/
-- services/leads.ts` é outra coisa — posts `for_sale=true`, não esta
-- tabela); toda leitura de `leads` no código vem do portal
-- (`public/portal/app.jsx`), sempre logado como admin. Travar pra
-- `is_portal_admin()` não tira acesso de ninguém que hoje usa a feature.
--
-- ESTADO REMOTO NÃO VERIFICADO: não há acesso a este ambiente pro banco
-- real do Supabase. É POSSÍVEL que alguém tenha habilitado RLS direto no
-- Dashboard, fora de qualquer migration — mas essa hipótese não está
-- provada nem pelo repositório nem por nenhuma anotação em CLAUDE.md (a
-- única menção existente, no `leads_por_telefone` de hoje mais cedo, foi
-- uma SUPOSIÇÃO não verificada, agora corrigida). Rodar de qualquer jeito:
-- `ENABLE ROW LEVEL SECURITY` é idempotente (no-op se já estava ligada), e
-- as policies usam DROP + CREATE (idempotente, sem CREATE POLICY IF NOT
-- EXISTS — Postgres não tem isso).
-- ============================================================================

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Um único ponto de acesso: só quem passa por `is_portal_admin()` (mesma
-- função usada em toda outra tabela back-office deste repo — leitura E
-- escrita, porque hoje TODO uso de `leads` no código (list, recentes,
-- updateStatus, remove, insertBatch, resolverLeads/leads_por_telefone) é
-- do portal logado como admin).
DROP POLICY IF EXISTS leads_admin_all ON public.leads;
CREATE POLICY leads_admin_all ON public.leads
  FOR ALL TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());

-- Defesa em profundidade: mesmo que o projeto tenha GRANT amplo herdado do
-- template padrão do Supabase, remove explicitamente o que `anon` poderia
-- ter em `leads` — a tabela nunca deveria ser alcançável sem sessão.
REVOKE ALL ON public.leads FROM anon;

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'leads: RLS habilitada' AS item,
       (SELECT relrowsecurity FROM pg_class WHERE relname='leads' AND relnamespace='public'::regnamespace) AS ok
UNION ALL SELECT 'leads: policy leads_admin_all existe',
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename='leads' AND policyname='leads_admin_all')
UNION ALL SELECT 'leads: anon sem GRANT',
       NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                     WHERE table_schema='public' AND table_name='leads' AND grantee='anon')
ORDER BY 1;

-- Prova funcional (rode logado como um usuário comum do app, NÃO admin —
-- pelo token dele no SQL Editor não dá pra simular `auth.uid()`; a forma
-- de provar de verdade é um `curl` contra o REST do Supabase com o token
-- de um usuário comum, ou testar no app/portal):
--   Antes do fix: `select * from leads;` como qualquer authenticated
--   devolvia todas as linhas. Depois do fix: devolve 0 linhas pra quem
--   NÃO é is_portal_admin(), e todas as linhas pra quem é.
