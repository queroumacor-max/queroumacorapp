-- Chave de idempotência do pedido da loja no servidor (2026-09-26)
-- ════════════════════════════════════════════════════════════════════
-- Fecha o "Não feito" da auditoria dos 19 pontos (PR #412): o dedupe de
-- `submitOrder` (next-app/lib/services/mkt.ts) era CHECK-THEN-ACT — lê os
-- pedidos 'pending' recentes com a mesma assinatura de carrinho, e só
-- então insere. Clique duplo rápido (o `enviandoRef` do CartView é síncrono
-- mas só cobre o MESMO componente montado; retry de rede depois de um
-- timeout, ou duas abas, passam pelos dois SELECTs antes de qualquer
-- INSERT terminar) podia criar dois pedidos idênticos.
--
-- Fix: RPC atômica com UNIQUE parcial em (user_id, client_order_key) —
-- mesmo padrão de `increment_material_cost`/`claim_wa_followup_nudge`.
-- O cliente gera a chave UMA VEZ por tentativa de checkout (useCart.ts) e
-- reusa ela em qualquer retry da MESMA tentativa; ao suceder, a próxima
-- tentativa (outro pedido de verdade) ganha chave nova.
--
-- Idempotente — seguro rerodar.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_order_key text;

-- NULL não colide entre si num índice UNIQUE (regra do Postgres) — pedido
-- antigo, sem chave, nunca é afetado. Parcial (`WHERE ... IS NOT NULL`) só
-- pra deixar isso explícito, não é estritamente necessário.
DROP INDEX IF EXISTS orders_user_client_order_key_idx;
CREATE UNIQUE INDEX orders_user_client_order_key_idx
  ON public.orders (user_id, client_order_key)
  WHERE client_order_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_order_idempotent(
  p_items jsonb,
  p_total numeric,
  p_client_order_key text
)
RETURNS TABLE(order_id uuid, total numeric, reused boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_total numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_client_order_key IS NULL OR btrim(p_client_order_key) = '' THEN
    RAISE EXCEPTION 'client_order_key obrigatorio';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'carrinho vazio';
  END IF;

  INSERT INTO public.orders (user_id, items, total, status, created_at, client_order_key)
  VALUES (v_uid, p_items, coalesce(p_total, 0), 'pending', now(), p_client_order_key)
  ON CONFLICT (user_id, client_order_key) WHERE client_order_key IS NOT NULL
  DO NOTHING
  RETURNING id, total INTO v_id, v_total;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_total, false;
    RETURN;
  END IF;

  -- Conflito: já existe pedido com essa chave pra este usuário (retry,
  -- clique duplo escapando da trava do cliente, 2 abas) — devolve o
  -- existente em vez de duplicar.
  SELECT o.id, o.total INTO v_id, v_total
  FROM public.orders o
  WHERE o.user_id = v_uid AND o.client_order_key = p_client_order_key
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'falha ao criar ou recuperar o pedido';
  END IF;

  RETURN QUERY SELECT v_id, v_total, true;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_order_idempotent(jsonb, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_order_idempotent(jsonb, numeric, text) TO authenticated;

-- ─── Conferência (rodar depois, só leitura) ────────────────────────────
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'client_order_key'
  ) AS coluna_existe,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'orders_user_client_order_key_idx'
  ) AS indice_unico_existe,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'submit_order_idempotent' AND p.prosecdef
  ) AS rpc_existe_e_security_definer,
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public' AND routine_name = 'submit_order_idempotent'
      AND grantee IN ('anon', 'public')
  ) AS anon_sem_execute;
