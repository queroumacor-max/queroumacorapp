-- ════════════════════════════════════════════════════════════════════
-- Crédito ÚNICO pra tudo — 2026-10-28 (decisão do usuário). Roda DEPOIS de
-- 2026-10-25-billing-balance.sql e 2026-10-25-billing-pro-and-ai-trial.sql.
--
-- Antes: crédito de orçamento e crédito de obra eram saldos separados, e a
-- IA era só PRO (com teste grátis). Agora 1 crédito vale QUALQUER coisa
-- paga: 1 orçamento, OU 1 obra, OU 1 uso de ferramenta com IA.
--   quote_1        = Avulso    → +1 crédito
--   quote_pack_40  = Iniciante → +40 créditos (não vencem)
--   quotes_unlimited = PRO ilimitado (não muda)
--   obra_1 saiu da tela; compra antiga dele continua valendo +1 crédito.
-- O grátis NÃO muda: 5 orçamentos + 1 obra + 1 teste por ferramenta de IA.
--
-- O saldo único mora em billing_balance.quote_credits (a coluna mantém o
-- nome antigo pra não quebrar quem lê). obra_credits é somado nela e zera.
--
-- A IA gasta crédito SEMPRE que o teste grátis acabou, com a cobrança
-- ligada ou não: ela já era paga antes desta mudança, então não há
-- "período de rollout" pra ela. Orçamento e obra seguem respeitando
-- billing_config.enforce.
--
-- Idempotente: pode rodar de novo. Cada comando numa linha (celular).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. usage_debits aceita 'ai' ──
ALTER TABLE public.usage_debits DROP CONSTRAINT IF EXISTS usage_debits_kind_check;
ALTER TABLE public.usage_debits ADD CONSTRAINT usage_debits_kind_check CHECK (kind IN ('quote', 'obra', 'ai'));
ALTER TABLE public.usage_debits ADD COLUMN IF NOT EXISTS feature text;

-- ── 2. Junta o saldo de obra no saldo único ──
UPDATE public.billing_balance SET quote_credits = quote_credits + obra_credits, obra_credits = 0, updated_at = now() WHERE obra_credits > 0;

-- ── 3. Débito de orçamento/obra: grátis do tipo → crédito único ──
CREATE OR REPLACE FUNCTION public._usage_debit(p_kind text, p_user uuid, p_ref uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.billing_config;
  v_bal public.billing_balance;
  v_free int;
  v_fonte text;
BEGIN
  IF p_kind NOT IN ('quote', 'obra') THEN RAISE EXCEPTION 'tipo inválido: %', p_kind; END IF;
  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  IF v_cfg IS NULL OR NOT v_cfg.enforce THEN RETURN 'off'; END IF;

  INSERT INTO public.billing_balance (user_id, free_quotes, free_obras)
  VALUES (p_user, v_cfg.free_quotes, v_cfg.free_obras) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_bal FROM public.billing_balance WHERE user_id = p_user FOR UPDATE;

  v_free := CASE WHEN p_kind = 'quote' THEN v_bal.free_quotes ELSE v_bal.free_obras END;

  IF public._billing_unlimited(p_user) THEN
    v_fonte := 'unlimited';
  ELSIF v_free > 0 THEN
    v_fonte := 'free';
    IF p_kind = 'quote' THEN
      UPDATE public.billing_balance SET free_quotes = free_quotes - 1, updated_at = now() WHERE user_id = p_user;
    ELSE
      UPDATE public.billing_balance SET free_obras = free_obras - 1, updated_at = now() WHERE user_id = p_user;
    END IF;
  ELSIF v_bal.quote_credits + v_bal.obra_credits > 0 THEN
    v_fonte := 'credit';
    IF v_bal.quote_credits > 0 THEN
      UPDATE public.billing_balance SET quote_credits = quote_credits - 1, updated_at = now() WHERE user_id = p_user;
    ELSE
      UPDATE public.billing_balance SET obra_credits = obra_credits - 1, updated_at = now() WHERE user_id = p_user;
    END IF;
  ELSIF p_kind = 'quote' THEN
    RAISE EXCEPTION 'quote_balance_empty' USING ERRCODE = 'P0402',
      HINT = 'Seus créditos acabaram: compre créditos ou assine o PRO.';
  ELSE
    RAISE EXCEPTION 'obra_balance_empty' USING ERRCODE = 'P0402',
      HINT = 'Seus créditos acabaram: compre créditos ou assine o PRO.';
  END IF;

  INSERT INTO public.usage_debits (kind, ref_id, user_id, fonte) VALUES (p_kind, p_ref, p_user, v_fonte);
  RETURN v_fonte;
END $$;
REVOKE ALL ON FUNCTION public._usage_debit(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. Débito de IA (SÓ service_role; a rota chama depois que o teste grátis acabou) ──
-- 'credit' = gastou 1 crédito; 'unlimited' = PRO, não gasta; 'empty' = sem saldo.
CREATE OR REPLACE FUNCTION public.debit_ai_credit(p_user uuid, p_feature text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.billing_config;
  v_bal public.billing_balance;
BEGIN
  IF p_user IS NULL THEN RETURN 'empty'; END IF;
  IF public._billing_unlimited(p_user) THEN RETURN 'unlimited'; END IF;
  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.billing_balance (user_id, free_quotes, free_obras)
  VALUES (p_user, COALESCE(v_cfg.free_quotes, 5), COALESCE(v_cfg.free_obras, 1)) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_bal FROM public.billing_balance WHERE user_id = p_user FOR UPDATE;
  IF v_bal.quote_credits > 0 THEN
    UPDATE public.billing_balance SET quote_credits = quote_credits - 1, updated_at = now() WHERE user_id = p_user;
  ELSIF v_bal.obra_credits > 0 THEN
    UPDATE public.billing_balance SET obra_credits = obra_credits - 1, updated_at = now() WHERE user_id = p_user;
  ELSE
    RETURN 'empty';
  END IF;
  INSERT INTO public.usage_debits (kind, ref_id, user_id, fonte, feature) VALUES ('ai', gen_random_uuid(), p_user, 'credit', left(COALESCE(p_feature, ''), 60));
  RETURN 'credit';
END $$;
REVOKE ALL ON FUNCTION public.debit_ai_credit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_ai_credit(uuid, text) TO service_role;

-- ── 5. Crédito de compra: todo consumível vira crédito único ──
CREATE OR REPLACE FUNCTION public.grant_billing_purchase(
  p_user uuid, p_transaction_id text, p_product_id text, p_platform text, p_raw jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
  v_dono uuid;
  v_cfg public.billing_config;
BEGIN
  IF p_user IS NULL OR COALESCE(p_transaction_id, '') = '' THEN RAISE EXCEPTION 'parâmetros inválidos'; END IF;
  CASE p_product_id
    WHEN 'quote_1' THEN v_n := 1;
    WHEN 'quote_pack_40' THEN v_n := 40;
    WHEN 'obra_1' THEN v_n := 1;
    ELSE RAISE EXCEPTION 'produto não é consumível: %', p_product_id;
  END CASE;

  SELECT user_id INTO v_dono FROM public.billing_events WHERE store_transaction_id = p_transaction_id;
  IF FOUND THEN
    RETURN CASE WHEN v_dono = p_user THEN 'duplicate' ELSE 'conflict' END;
  END IF;

  INSERT INTO public.billing_events (store_transaction_id, user_id, product_id, platform, kind, credit_kind, credits_granted, raw)
  VALUES (p_transaction_id, p_user, p_product_id, p_platform, 'purchase', 'quote', v_n, p_raw)
  ON CONFLICT (store_transaction_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.billing_balance (user_id, free_quotes, free_obras)
  VALUES (p_user, COALESCE(v_cfg.free_quotes, 5), COALESCE(v_cfg.free_obras, 1)) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.billing_balance SET quote_credits = quote_credits + v_n, updated_at = now() WHERE user_id = p_user;
  RETURN 'granted';
END $$;
REVOKE ALL ON FUNCTION public.grant_billing_purchase(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_billing_purchase(uuid, text, text, text, jsonb) TO service_role;

-- ── 6. Reembolso: tira do saldo único (o que já foi gasto não volta) ──
CREATE OR REPLACE FUNCTION public.revoke_billing_purchase(p_transaction_id text, p_raw jsonb DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ev public.billing_events;
BEGIN
  SELECT * INTO v_ev FROM public.billing_events WHERE store_transaction_id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF v_ev.status = 'refunded' THEN RETURN 'duplicate'; END IF;
  UPDATE public.billing_events SET status = 'refunded', updated_at = now(),
    raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('refund', p_raw)
  WHERE id = v_ev.id;
  IF v_ev.user_id IS NOT NULL AND v_ev.credits_granted > 0 THEN
    UPDATE public.billing_balance SET quote_credits = GREATEST(quote_credits - v_ev.credits_granted, 0), updated_at = now() WHERE user_id = v_ev.user_id;
  END IF;
  RETURN 'revoked';
END $$;
REVOKE ALL ON FUNCTION public.revoke_billing_purchase(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_billing_purchase(text, jsonb) TO service_role;

-- ── Conferência (uma linha por item, ok = true) ──
SELECT 'usage_debits aceita ai' AS item, EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usage_debits_kind_check' AND pg_get_constraintdef(oid) LIKE '%ai%') AS ok
UNION ALL SELECT 'saldo de obra juntado', NOT EXISTS (SELECT 1 FROM public.billing_balance WHERE obra_credits > 0)
UNION ALL SELECT 'debit_ai_credit existe', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'debit_ai_credit')
UNION ALL SELECT 'authenticated NÃO debita IA', NOT has_function_privilege('authenticated', 'public.debit_ai_credit(uuid,text)', 'EXECUTE')
UNION ALL SELECT 'compra credita saldo único', (SELECT prosrc NOT LIKE '%obra_credits = obra_credits + v_n%' FROM pg_proc WHERE oid = 'public.grant_billing_purchase(uuid,text,text,text,jsonb)'::regprocedure);
