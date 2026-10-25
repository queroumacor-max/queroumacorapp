-- 2026-10-25 — Correção do billing-balance (achado do Codex no PR #484).
--
-- O billing-balance recriou `quotes_insert_participants` só com
-- `auth.uid() = client_id` e PERDEU a trava de 09-16 que proíbe
-- client_id = painter_id. Sem ela, um pintor grava pelo REST um orçamento
-- "pedido por ele mesmo pra ele mesmo": pula o débito do saldo (que só
-- existe dentro de create_painter_draft) e volta a ganhar os pontos de
-- pedido de orçamento (award_quote_request_points).
--
-- Idempotente. Nenhum fluxo do app grava quote com o mesmo id nos dois
-- lados (cliente pede pela RPC create_quote_from_post; pintor grava pela
-- create_painter_draft, com client_id NULL).

DROP POLICY IF EXISTS quotes_insert_participants ON public.quotes;
CREATE POLICY quotes_insert_participants ON public.quotes FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = client_id AND (painter_id IS NULL OR painter_id <> client_id));

-- Conferência: deve voltar ok = true.
SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%painter_id <> client_id%') AS ok FROM pg_policy WHERE polname = 'quotes_insert_participants';
