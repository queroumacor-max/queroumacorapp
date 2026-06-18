-- 2026-06-18-rls-security-fixes.sql
-- Correções de RLS pós-auditoria de segurança Supabase.
-- Cobre os itens IMEDIATOS 1, 2 e 3 da auditoria:
--   1) exec_sql / executar_sql acessíveis a anon/authenticated (RCE/SQLi)
--   2) políticas com "OR true" no fim (posts SELECT, products INSERT)
--   3) políticas de INSERT com role {public} (anon escreve) → {authenticated}
--
-- Idempotente: pode rodar mais de uma vez sem erro.
-- Rodar no Supabase SQL Editor (Claude não tem acesso ao banco).

BEGIN;

-- =====================================================================
-- ITEM 1 — exec_sql / executar_sql: revogar de PUBLIC/anon/authenticated
-- =====================================================================
-- Essas funções SECURITY DEFINER executam SQL arbitrário. O app
-- QueroUmaCor NÃO as utiliza (verificado em todo o código TS/JS).
-- Revogamos de toda role não privilegiada; service_role continua podendo
-- chamá-las (não é afetado por REVOKE de PUBLIC/anon/authenticated, pois
-- é superusuário lógico no Supabase). O loop usa a assinatura real de
-- cada função, cobrindo eventuais overloads.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('exec_sql', 'executar_sql')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;',
      r.proname, r.args
    );
    RAISE NOTICE 'Revogado EXECUTE de public.%(%)', r.proname, r.args;
  END LOOP;
END $$;

-- OPCIONAL (recomendado se confirmar que nenhuma tooling externa de
-- migration usa essas funções): dropar de vez. Deixado comentado por
-- segurança — descomente e rode separadamente após confirmar.
-- DROP FUNCTION IF EXISTS public.exec_sql(text);
-- DROP FUNCTION IF EXISTS public.executar_sql(text);

-- =====================================================================
-- ITEM 2 — remover "OR true" de políticas (drift do banco vivo)
-- =====================================================================

-- posts: remove o "OR true" (que torna QUALQUER post — inclusive deletado e
-- de terceiros em moderação — legível por qualquer um). IMPORTANTE: inclui
-- `status IS NULL` no predicado. Posts legados pré-moderação têm status NULL
-- e TODOS os caminhos de leitura do app os tratam como públicos
-- (next-app/lib/db.ts: `status.eq.approved,status.is.null`; RPC get_feed_v2:
-- `p.status = 'approved' OR p.status IS NULL`). Sem o `OR status IS NULL`,
-- esses posts antigos sumiriam do público — regressão. A def do repo em
-- 2026-05-31-soft-delete.sql tem o mesmo gap latente; esta versão corrige.
DROP POLICY IF EXISTS "View posts active" ON public.posts;
CREATE POLICY "View posts active" ON public.posts
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      status = 'approved'
      OR status IS NULL
      OR user_id = auth.uid()
      OR public.is_portal_admin()
    )
  );

-- products: INSERT só para admin do portal. O "OR true" deixava qualquer
-- autenticado inserir produtos. Recriamos restringindo a is_portal_admin().
DROP POLICY IF EXISTS "Authenticated can insert products" ON public.products;
CREATE POLICY "Authenticated can insert products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_portal_admin());

-- =====================================================================
-- ITEM 3 — INSERT policies com role {public} → {authenticated}
-- =====================================================================
-- ALTER POLICY ... TO authenticated muda só o conjunto de roles,
-- preservando USING / WITH CHECK existentes. Guardado por DO block pra
-- não abortar a migration caso algum nome de policy difira no banco.
DO $$
DECLARE
  fix record;
BEGIN
  FOR fix IN
    SELECT * FROM (VALUES
      ('certificates',  'certs_own_write'),
      ('qualifications','quals dono insere'),
      ('follows',       'follows_own_write'),
      ('likes',         'likes_own_write'),
      ('courses',       'courses_own_write')
    ) AS t(tbl, pol)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = fix.tbl
        AND policyname = fix.pol
    ) THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I TO authenticated;',
        fix.pol, fix.tbl
      );
      RAISE NOTICE 'Policy % em % agora restrita a authenticated', fix.pol, fix.tbl;
    ELSE
      RAISE WARNING 'Policy % em % NAO encontrada — verifique o nome', fix.pol, fix.tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- VERIFICAÇÃO (rode separadamente após o COMMIT)
-- =====================================================================
-- 1) exec_sql/executar_sql não devem ter EXECUTE pra anon/authenticated:
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname IN ('exec_sql','executar_sql');
--
-- 2) Nenhuma policy deve conter "OR true":
--   SELECT schemaname, tablename, policyname, qual, with_check
--   FROM pg_policies
--   WHERE qual ILIKE '%or true%' OR with_check ILIKE '%or true%';
--
-- 3) INSERT policies não devem mais ter {public}:
--   SELECT tablename, policyname, roles, cmd
--   FROM pg_policies
--   WHERE tablename IN ('certificates','qualifications','follows','likes','courses')
--   ORDER BY tablename, policyname;
