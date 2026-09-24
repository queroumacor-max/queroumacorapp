-- ════════════════════════════════════════════════════════════════════
-- PARTE A — quotes: só o PINTOR (e admin) altera um orçamento (2026-09-24)
-- ════════════════════════════════════════════════════════════════════
-- Achado ao implementar "editar orçamento": a policy de UPDATE herdada do
-- supabase_init ("Users can update own quotes", USING/WITH CHECK
-- client_id OR painter_id) deixava o CLIENTE do orçamento mudar preço,
-- quote_data e status via PATCH direto no REST. A migration de 09-16 só
-- congelou client_id/painter_id (trigger protect_quote_ownership).
--
-- Nenhum fluxo do app escreve em `quotes` como cliente: todo UPDATE do
-- next-app filtra por painter_id, o portal só lê, e a criação pelo
-- cliente passa por RPC SECURITY DEFINER (create_quote_from_post), que não
-- depende desta policy. Então tirar o cliente do UPDATE não quebra nada.
--
-- Idempotente. Conferência no fim: deve sobrar SÓ quotes_update_painter
-- com cmd UPDATE, e nenhuma policy ALL.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quotes' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.quotes', r.policyname);
  END LOOP;
END $$;

CREATE POLICY quotes_update_painter ON public.quotes
  FOR UPDATE TO authenticated
  USING (painter_id = (SELECT auth.uid()) OR (SELECT public.is_portal_admin()))
  WITH CHECK (painter_id = (SELECT auth.uid()) OR (SELECT public.is_portal_admin()));

-- Conferência: 1 linha (quotes_update_painter). Se aparecer uma linha com
-- cmd = ALL, ela também libera UPDATE — me mande o print.
SELECT policyname, cmd, qual FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'quotes' AND cmd IN ('UPDATE', 'ALL');
