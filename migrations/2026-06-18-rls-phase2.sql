-- 2026-06-18-rls-phase2.sql
-- Fase 2 do hardening RLS pós-auditoria (continuação de 2026-06-18-rls-security-fixes.sql).
-- Cobre o ERROR e os WARNINGS restantes do Security Advisor:
--   (a) profiles_public → SECURITY INVOKER  (1 ERROR)
--   (b) search_path fixo em search_all + sync_profile_following_count (2 WARNINGS)
--   (c) get_painter_reviews: MANTIDA por design (documentado, sem mudança)
--   (d) log_portal_message_access + notify_on_comment_like → REVOKE EXECUTE
--       de roles públicas (são trigger functions; fecha o "callable via RPC")
--
-- exec_sql/executar_sql ficam pra Fase 3 (DROP após confirmar sem uso externo).
--
-- Idempotente. Rodar no Supabase SQL Editor (Claude não tem acesso ao banco).

BEGIN;

-- =====================================================================
-- (a) profiles_public → SECURITY INVOKER
-- =====================================================================
-- A view foi recriada nas Waves 32 (2026-06-12) e counters (2026-06-14) com
-- `create view ... as` SEM o flag, revertendo pro default (definer) — daí o
-- ERROR do advisor. A tabela base `profiles` tem policy de SELECT
-- "Profiles are viewable by everyone" (roles=PUBLIC, USING true), então anon
-- JÁ lê profiles diretamente. Logo, ligar security_invoker faz a view
-- respeitar a RLS como caller SEM regressão de leitura pública (guest mode
-- continua vendo perfis/autores). ALTER VIEW preserva a definição atual
-- (followers_count/following_count/posts_count etc.), sem precisar recriar.
ALTER VIEW public.profiles_public SET (security_invoker = true);

-- =====================================================================
-- (b) search_path fixo (anti search_path injection)
-- =====================================================================
DO $$
BEGIN
  -- search_all(text, integer): SECURITY INVOKER, corpo 100% schema-qualificado
  -- (public.profiles/posts/products + builtins de pg_catalog, que é sempre
  -- implícito). search_path = '' é seguro e segue a convenção das outras 55
  -- funções já hardened. Chamada por anon na busca (guest mode).
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='search_all'
      AND pg_get_function_identity_arguments(p.oid) = 'text, integer'
  ) THEN
    ALTER FUNCTION public.search_all(text, integer) SET search_path = '';
    RAISE NOTICE 'search_all: search_path = ''''';
  ELSE
    RAISE WARNING 'search_all(text, integer) NAO encontrada — verifique assinatura';
  END IF;

  -- sync_profile_following_count(): trigger function (não chamada via PostgREST).
  -- O corpo NÃO está versionado no repo, então uso `public` (não '') pra não
  -- arriscar quebrar referências não-qualificadas a profiles/follows. `public`
  -- já fixa o search_path e resolve o warning. Se depois confirmar que o corpo
  -- qualifica tudo (public.*), trocar por '' pra alinhar com as demais.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='sync_profile_following_count'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    ALTER FUNCTION public.sync_profile_following_count() SET search_path = public;
    RAISE NOTICE 'sync_profile_following_count: search_path = public';
  ELSE
    RAISE WARNING 'sync_profile_following_count() NAO encontrada — verifique assinatura';
  END IF;
END $$;

-- =====================================================================
-- (c) get_painter_reviews — MANTIDA POR DESIGN (nenhuma mudança)
-- =====================================================================
-- SECURITY DEFINER intencional: faz o join reviews × quotes × profiles
-- server-side pra exibir avaliações no perfil público SEM vazar o PII das
-- quotes (endereço/telefone/valor) — a Wave 27 (B4) fechou o SELECT de quotes.
-- É chamada por anon em /perfil/[id] (lib/services/reviews.ts).
-- NÃO revogar (quebraria reviews no perfil público) e NÃO trocar pra invoker
-- (reintroduz o bloqueio de quotes). Já tem `set search_path = public`.
-- O warning "Public Can Execute SECURITY DEFINER" é ACEITO por design.

-- =====================================================================
-- (d) log_portal_message_access + notify_on_comment_like → REVOKE EXECUTE
-- =====================================================================
-- Nenhum caller no código (grep em todo o repo, incl. portal vanilla = vazio);
-- os nomes indicam trigger functions (auditoria de acesso a mensagens do
-- portal / notificação de like em comentário no sininho). Triggers disparam
-- como owner do trigger, INDEPENDENTE de EXECUTE grant — então revogar
-- EXECUTE das roles públicas fecha o vetor "chamável via RPC por anon/auth"
-- sem afetar o funcionamento via trigger. service_role/owner mantêm acesso.
-- Loop cobre assinatura real e eventuais overloads.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('log_portal_message_access', 'notify_on_comment_like')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;',
      r.proname, r.args
    );
    RAISE NOTICE 'Revogado EXECUTE de public.%(%)', r.proname, r.args;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- VERIFICAÇÃO (rode separadamente após o COMMIT)
-- =====================================================================
-- 1) profiles_public deve ter security_invoker=true:
--   SELECT relname, reloptions FROM pg_class WHERE relname = 'profiles_public';
--   -- esperado: {security_invoker=true}
--
-- 2) Smoke test da view como anon (deve retornar linhas, sem erro de permissão):
--   SET ROLE anon; SELECT id, name FROM public.profiles_public LIMIT 1; RESET ROLE;
--
-- 3) search_path fixado nas 2 funções:
--   SELECT proname, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public'
--     AND proname IN ('search_all','sync_profile_following_count');
--
-- 4) EXECUTE revogado nas 2 trigger functions:
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public'
--     AND p.proname IN ('log_portal_message_access','notify_on_comment_like');
--   -- esperado: anon=false, auth=false
--
-- 5) Pós-deploy: abrir busca como visitante, abrir um perfil público com
--    avaliações, seguir/deixar de seguir alguém logado (exercita o trigger
--    sync_profile_following_count).
