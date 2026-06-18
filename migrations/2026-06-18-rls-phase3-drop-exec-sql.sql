-- 2026-06-18-rls-phase3-drop-exec-sql.sql
-- Fase 3 do hardening RLS: DROP definitivo de exec_sql / executar_sql.
--
-- Pré-requisitos já feitos na Fase 1 (2026-06-18-rls-security-fixes.sql):
--   EXECUTE já revogado de PUBLIC/anon/authenticated. Zero uso no código
--   (app Next + portal vanilla, verificado por grep em todo o repo).
--
-- Este arquivo remove as funções de vez. SEM CASCADE de propósito: se algum
-- objeto depender delas (view/função/trigger), o DROP falha e o erro revela a
-- dependência — preferível a apagar objetos em silêncio.
--
-- Idempotente (IF EXISTS + loop por assinatura real, cobre overloads).

-- =====================================================================
-- PRÉ-CHECK — rode ANTES, separadamente. Se QUALQUER um retornar linhas,
-- investigue antes de dropar (há uso server-side que o grep no repo não vê).
-- =====================================================================
--   -- (a) jobs de pg_cron que chamem as funções:
--   SELECT jobid, jobname, command FROM cron.job
--   WHERE command ILIKE '%exec_sql%' OR command ILIKE '%executar_sql%';
--
--   -- (b) outras funções cujo corpo referencie as funções:
--   SELECT n.nspname, p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE (p.prosrc ILIKE '%exec_sql%' OR p.prosrc ILIKE '%executar_sql%')
--     AND p.proname NOT IN ('exec_sql','executar_sql');
--
--   -- (c) triggers cujo corpo referencie (coberto por (b), mas explícito):
--   SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
--     AND tgfoid IN (
--       SELECT oid FROM pg_proc
--       WHERE prosrc ILIKE '%exec_sql%' OR prosrc ILIKE '%executar_sql%'
--     );

-- =====================================================================
-- DROP
-- =====================================================================
BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('exec_sql', 'executar_sql')
  LOOP
    -- RESTRICT (default): falha se houver dependência, em vez de cascatear.
    EXECUTE format('DROP FUNCTION IF EXISTS %s;', r.sig);
    RAISE NOTICE 'Dropada função %', r.sig;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- VERIFICAÇÃO (rode após o COMMIT)
-- =====================================================================
--   SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND proname IN ('exec_sql','executar_sql');
--   -- esperado: 0 linhas
