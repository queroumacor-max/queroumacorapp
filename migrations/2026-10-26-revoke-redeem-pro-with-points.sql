-- PRO não sai mais por pontos (2026-10-26, decisão do usuário): é só
-- assinatura paga na loja (RevenueCat). A tela já não chama a RPC, mas ela é
-- SECURITY DEFINER com EXECUTE pra authenticated: sem este REVOKE, qualquer
-- conta logada ainda trocaria pontos por PRO direto pelo REST.
-- Não apaga a função (fica pra histórico/reversão). Idempotente.
-- Cada statement numa linha só (colagem pelo celular).

DO $$ DECLARE f regprocedure; BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'redeem_pro_with_points' LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f); END LOOP; END $$;

-- Conferência: tem que voltar ok = true (ou zero linhas, se a função não existir).
SELECT p.oid::regprocedure AS funcao, NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS ok FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'redeem_pro_with_points';
