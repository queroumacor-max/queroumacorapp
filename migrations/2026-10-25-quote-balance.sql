-- ════════════════════════════════════════════════════════════════════
-- Saldo de orçamentos (freemium + compras in-app) — 2026-10-25.
--
-- Regras (decisão do usuário):
--   - 5 orçamentos grátis pra TODO mundo (inclusive quem já usa);
--   - conta quando o orçamento é GRAVADO (create_painter_draft);
--   - ordem: ilimitado (assinatura OU PRO antigo OU admin) → grátis →
--     créditos comprados;
--   - quote_1 = +1 crédito, quote_pack_40 = +40, quotes_unlimited =
--     assinatura (não dá crédito, libera tudo até unlimited_until).
--   - preço NÃO mora aqui: é o das lojas.
--
-- Quem escreve saldo: só esta migration (funções SECURITY DEFINER). O
-- usuário só LÊ o próprio saldo. Crédito só via service_role (a rota que
-- confere a compra no servidor) — nunca com base no que o app diz.
--
-- ROLLOUT: billing_config.enforce_quotes nasce FALSE. Desligado, o
-- débito NÃO acontece e ninguém é barrado — o app pode ir pro ar antes
-- da build com a tela de compra. Ligar só quando o AAB/IPA com o
-- paywall estiver nas lojas:
--   UPDATE public.billing_config SET enforce_quotes = true WHERE id = 1;
--
-- ANTES DE RODAR: conferir se o create_painter_draft vivo ainda é o da
-- Wave 42 (o passo 6 recria por cima):
--   SELECT pg_get_functiondef('public.create_painter_draft(text,text,text,numeric,numeric,jsonb)'::regprocedure);
-- Idempotente: pode rodar de novo.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Configuração (linha única) ──
CREATE TABLE IF NOT EXISTS public.billing_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforce_quotes boolean NOT NULL DEFAULT false,
  free_quotes int NOT NULL DEFAULT 5 CHECK (free_quotes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.billing_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.billing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_config_read ON public.billing_config;
CREATE POLICY billing_config_read ON public.billing_config FOR SELECT TO authenticated USING (true);

-- ── 2. Saldo por usuário ──
CREATE TABLE IF NOT EXISTS public.quote_balance (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  free_remaining int NOT NULL DEFAULT 5 CHECK (free_remaining >= 0),
  credits int NOT NULL DEFAULT 0 CHECK (credits >= 0),
  unlimited_until timestamptz,
  unlimited_status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_balance_own_read ON public.quote_balance;
CREATE POLICY quote_balance_own_read ON public.quote_balance FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ── 3. Eventos de compra (antifraude: transação credita UMA vez) ──
CREATE TABLE IF NOT EXISTS public.billing_events (
  id bigserial PRIMARY KEY,
  store_transaction_id text NOT NULL UNIQUE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  product_id text NOT NULL,
  platform text,
  kind text NOT NULL,
  credits_granted int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'applied',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON public.billing_events (user_id, created_at DESC);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_events_own_read ON public.billing_events;
CREATE POLICY billing_events_own_read ON public.billing_events FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_portal_admin()));

-- ── 4. Débitos (1 por orçamento — o mesmo orçamento nunca debita 2x) ──
CREATE TABLE IF NOT EXISTS public.quote_debits (
  id bigserial PRIMARY KEY,
  quote_id uuid UNIQUE REFERENCES public.quotes(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  fonte text NOT NULL CHECK (fonte IN ('free', 'credit', 'unlimited')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_debits_user ON public.quote_debits (user_id, created_at DESC);
ALTER TABLE public.quote_debits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_debits_own_read ON public.quote_debits;
CREATE POLICY quote_debits_own_read ON public.quote_debits FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ── 5. Débito atômico (interno; só as funções abaixo chamam) ──
-- Garante a linha (nasce com os grátis da config), TRAVA ela (FOR
-- UPDATE: dois "Gravar" quase juntos não gastam o mesmo crédito) e
-- decide a fonte. Sem saldo → P0402 'quote_balance_empty', e a
-- transação inteira (inclusive o INSERT do orçamento) é desfeita.
CREATE OR REPLACE FUNCTION public._quote_debit(p_user uuid, p_quote uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.billing_config;
  v_bal public.quote_balance;
  v_pro boolean;
  v_fonte text;
BEGIN
  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  IF v_cfg IS NULL OR NOT v_cfg.enforce_quotes THEN RETURN 'off'; END IF;

  INSERT INTO public.quote_balance (user_id, free_remaining)
  VALUES (p_user, v_cfg.free_quotes) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_bal FROM public.quote_balance WHERE user_id = p_user FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_user AND p.is_pro = true
      AND (p.pro_expires_at IS NULL OR p.pro_expires_at > now()
           OR (p.pro_grace_until IS NOT NULL AND p.pro_grace_until > now()))
  ) OR public.is_portal_admin() INTO v_pro;

  IF v_pro OR (v_bal.unlimited_until IS NOT NULL AND v_bal.unlimited_until > now()) THEN
    v_fonte := 'unlimited';
  ELSIF v_bal.free_remaining > 0 THEN
    v_fonte := 'free';
    UPDATE public.quote_balance SET free_remaining = free_remaining - 1, updated_at = now() WHERE user_id = p_user;
  ELSIF v_bal.credits > 0 THEN
    v_fonte := 'credit';
    UPDATE public.quote_balance SET credits = credits - 1, updated_at = now() WHERE user_id = p_user;
  ELSE
    RAISE EXCEPTION 'quote_balance_empty' USING ERRCODE = 'P0402',
      HINT = 'Sem orçamentos disponíveis: compre um pacote ou assine o ilimitado.';
  END IF;

  INSERT INTO public.quote_debits (quote_id, user_id, fonte) VALUES (p_quote, p_user, v_fonte);
  RETURN v_fonte;
END $$;
REVOKE ALL ON FUNCTION public._quote_debit(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. create_painter_draft (Wave 42) + débito ──
-- Mesma assinatura, mesmos campos; só ganhou a linha do débito. O
-- débito roda DEPOIS do INSERT (precisa do id) mas na mesma transação:
-- sem saldo, o orçamento não fica gravado.
CREATE OR REPLACE FUNCTION public.create_painter_draft(
  p_client_name  text,
  p_service_type text,
  p_title        text,
  p_area_m2      numeric,
  p_price        numeric,
  p_quote_data   jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para salvar rascunho'; END IF;
  INSERT INTO public.quotes (
    painter_id, client_id, client_name, service_type, title,
    area_m2, price, status, quote_data, created_at
  ) VALUES (
    auth.uid(), NULL,
    COALESCE(NULLIF(TRIM(p_client_name), ''), 'Cliente'),
    COALESCE(NULLIF(TRIM(p_service_type), ''), 'Orçamento'),
    COALESCE(NULLIF(TRIM(p_title), ''), 'Orçamento'),
    p_area_m2, COALESCE(p_price, 0), 'rascunho',
    COALESCE(p_quote_data, '{}'::jsonb), now()
  ) RETURNING id INTO v_id;
  PERFORM public._quote_debit(auth.uid(), v_id);
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_painter_draft(text, text, text, numeric, numeric, jsonb) TO authenticated;

-- ── 7. Fecha o INSERT direto do pintor em quotes ──
-- A policy de fallback da Wave 42 deixava o pintor inserir rascunho
-- direto pelo REST — o que pularia o débito. Nenhum código do app faz
-- isso (tudo passa pela RPC); fica só o cliente criando a própria.
DROP POLICY IF EXISTS quotes_insert_participants ON public.quotes;
CREATE POLICY quotes_insert_participants ON public.quotes FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = client_id);

-- ── 8. Saldo do usuário logado (tela/paywall) ──
CREATE OR REPLACE FUNCTION public.my_quote_balance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg public.billing_config;
  v_bal public.quote_balance;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.quote_balance (user_id, free_remaining)
  VALUES (v_uid, COALESCE(v_cfg.free_quotes, 5)) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_bal FROM public.quote_balance WHERE user_id = v_uid;
  RETURN jsonb_build_object(
    'free_remaining', v_bal.free_remaining,
    'credits', v_bal.credits,
    'unlimited_until', v_bal.unlimited_until,
    'unlimited_status', v_bal.unlimited_status,
    'pro_active', public.is_pro_active(v_uid) OR public.is_portal_admin(),
    'enforced', COALESCE(v_cfg.enforce_quotes, false)
  );
END $$;
REVOKE ALL ON FUNCTION public.my_quote_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_quote_balance() TO authenticated;

-- ── 9. Crédito de consumível (SÓ service_role, depois de conferir) ──
-- Idempotente pela transação da loja. Mesma transação de novo, mesmo
-- usuário → 'duplicate' (sem crédito). Outro usuário → 'conflict'
-- (token reaproveitado em outra conta: não credita).
CREATE OR REPLACE FUNCTION public.grant_quote_purchase(
  p_user uuid, p_transaction_id text, p_product_id text, p_platform text, p_raw jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_creditos int;
  v_dono uuid;
  v_cfg public.billing_config;
BEGIN
  IF p_user IS NULL OR COALESCE(p_transaction_id, '') = '' THEN RAISE EXCEPTION 'parâmetros inválidos'; END IF;
  v_creditos := CASE p_product_id WHEN 'quote_1' THEN 1 WHEN 'quote_pack_40' THEN 40 ELSE 0 END;
  IF v_creditos = 0 THEN RAISE EXCEPTION 'produto não é consumível: %', p_product_id; END IF;

  SELECT user_id INTO v_dono FROM public.billing_events WHERE store_transaction_id = p_transaction_id;
  IF FOUND THEN
    RETURN CASE WHEN v_dono = p_user THEN 'duplicate' ELSE 'conflict' END;
  END IF;

  INSERT INTO public.billing_events (store_transaction_id, user_id, product_id, platform, kind, credits_granted, raw)
  VALUES (p_transaction_id, p_user, p_product_id, p_platform, 'purchase', v_creditos, p_raw)
  ON CONFLICT (store_transaction_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.quote_balance (user_id, free_remaining, credits)
  VALUES (p_user, COALESCE(v_cfg.free_quotes, 5), v_creditos)
  ON CONFLICT (user_id) DO UPDATE SET credits = public.quote_balance.credits + v_creditos, updated_at = now();
  RETURN 'granted';
END $$;
REVOKE ALL ON FUNCTION public.grant_quote_purchase(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_quote_purchase(uuid, text, text, text, jsonb) TO service_role;

-- ── 10. Reembolso de consumível (SÓ service_role) ──
-- Tira os créditos que a transação deu (sem ficar negativo — o que já
-- foi gasto não volta). Idempotente.
CREATE OR REPLACE FUNCTION public.revoke_quote_purchase(p_transaction_id text, p_raw jsonb DEFAULT NULL)
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
    UPDATE public.quote_balance SET credits = GREATEST(credits - v_ev.credits_granted, 0), updated_at = now()
    WHERE user_id = v_ev.user_id;
  END IF;
  RETURN 'revoked';
END $$;
REVOKE ALL ON FUNCTION public.revoke_quote_purchase(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_quote_purchase(text, jsonb) TO service_role;

-- ── 11. Estado da assinatura ilimitada (SÓ service_role) ──
-- Chamado a cada evento da loja (compra, renovação, cancelamento,
-- expiração, carência, reembolso). Grava a DATA DE FIM que a loja
-- informa: cancelado continua valendo até lá; reembolso/expirado manda
-- uma data passada (ou NULL). Idempotente pelo id do evento.
CREATE OR REPLACE FUNCTION public.set_quote_subscription(
  p_user uuid, p_event_id text, p_until timestamptz, p_status text, p_platform text, p_raw jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dono uuid;
  v_cfg public.billing_config;
BEGIN
  IF p_user IS NULL OR COALESCE(p_event_id, '') = '' THEN RAISE EXCEPTION 'parâmetros inválidos'; END IF;
  SELECT user_id INTO v_dono FROM public.billing_events WHERE store_transaction_id = p_event_id;
  IF FOUND THEN
    RETURN CASE WHEN v_dono = p_user THEN 'duplicate' ELSE 'conflict' END;
  END IF;

  INSERT INTO public.billing_events (store_transaction_id, user_id, product_id, platform, kind, raw)
  VALUES (p_event_id, p_user, 'quotes_unlimited', p_platform, COALESCE(p_status, 'update'), p_raw)
  ON CONFLICT (store_transaction_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.quote_balance (user_id, free_remaining, unlimited_until, unlimited_status)
  VALUES (p_user, COALESCE(v_cfg.free_quotes, 5), p_until, p_status)
  ON CONFLICT (user_id) DO UPDATE SET unlimited_until = p_until, unlimited_status = p_status, updated_at = now();
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION public.set_quote_subscription(uuid, text, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_quote_subscription(uuid, text, timestamptz, text, text, jsonb) TO service_role;

-- ── Conferência (uma linha por item, ok = true) ──
SELECT 'billing_config (cobrança desligada)' AS item, EXISTS (SELECT 1 FROM public.billing_config WHERE id = 1 AND enforce_quotes = false) AS ok
UNION ALL SELECT 'quote_balance com RLS', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.quote_balance'::regclass)
UNION ALL SELECT 'billing_events com RLS', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_events'::regclass)
UNION ALL SELECT 'quote_debits com RLS', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.quote_debits'::regclass)
UNION ALL SELECT 'create_painter_draft debita', (SELECT prosrc LIKE '%_quote_debit%' FROM pg_proc WHERE oid = 'public.create_painter_draft(text,text,text,numeric,numeric,jsonb)'::regprocedure)
UNION ALL SELECT 'authenticated NÃO credita', NOT has_function_privilege('authenticated', 'public.grant_quote_purchase(uuid,text,text,text,jsonb)', 'EXECUTE')
UNION ALL SELECT 'authenticated NÃO debita direto', NOT has_function_privilege('authenticated', 'public._quote_debit(uuid,uuid)', 'EXECUTE')
UNION ALL SELECT 'pintor não insere quote direto', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotes' AND policyname = 'quotes_insert_participants' AND with_check NOT LIKE '%painter_id%');
