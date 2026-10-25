-- ════════════════════════════════════════════════════════════════════
-- Saldo de uso (freemium + compras in-app) — 2026-10-25.
--
-- Regras (decisão do usuário):
--   ORÇAMENTOS: 5 grátis pra TODO mundo; conta ao GRAVAR
--     (create_painter_draft). quote_1 = +1, quote_pack_40 = +40.
--   GESTÃO DE OBRAS: 1 obra grátis pra todo mundo; conta ao CRIAR a
--     obra (obras existentes não contam). obra_1 = +1 obra.
--   ASSINATURA quotes_unlimited = "PRO completo": orçamentos e obras
--     ilimitados enquanto valer. PRO antigo (manual/pontos) e admin
--     também são ilimitados.
--   Ordem de débito: ilimitado (não debita) → grátis → créditos.
--   Preço NÃO mora aqui: é o das lojas.
--
-- Quem escreve saldo: só as funções SECURITY DEFINER daqui. O usuário só
-- LÊ o próprio saldo. Crédito só via service_role (a rota que confere a
-- compra no servidor) — nunca com base no que o app diz.
--
-- ROLLOUT: billing_config.enforce nasce FALSE. Desligado, nada é
-- debitado nem barrado — o app pode ir pro ar antes da build com a
-- tela de compra. Ligar só quando o AAB/IPA com o paywall estiver nas
-- lojas:
--   UPDATE public.billing_config SET enforce = true WHERE id = 1;
--
-- ANTES DE RODAR: conferir se o create_painter_draft vivo ainda é o da
-- Wave 42 (o passo 7 recria por cima):
--   SELECT pg_get_functiondef('public.create_painter_draft(text,text,text,numeric,numeric,jsonb)'::regprocedure);
-- Idempotente: pode rodar de novo.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Configuração (linha única) ──
CREATE TABLE IF NOT EXISTS public.billing_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforce boolean NOT NULL DEFAULT false,
  free_quotes int NOT NULL DEFAULT 5 CHECK (free_quotes >= 0),
  free_obras int NOT NULL DEFAULT 1 CHECK (free_obras >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.billing_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.billing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_config_read ON public.billing_config;
CREATE POLICY billing_config_read ON public.billing_config FOR SELECT TO authenticated USING (true);

-- ── 2. Saldo por usuário ──
CREATE TABLE IF NOT EXISTS public.billing_balance (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  free_quotes int NOT NULL DEFAULT 5 CHECK (free_quotes >= 0),
  quote_credits int NOT NULL DEFAULT 0 CHECK (quote_credits >= 0),
  free_obras int NOT NULL DEFAULT 1 CHECK (free_obras >= 0),
  obra_credits int NOT NULL DEFAULT 0 CHECK (obra_credits >= 0),
  unlimited_until timestamptz,
  unlimited_status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_balance_own_read ON public.billing_balance;
CREATE POLICY billing_balance_own_read ON public.billing_balance FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ── 3. Eventos de compra (antifraude: transação credita UMA vez) ──
CREATE TABLE IF NOT EXISTS public.billing_events (
  id bigserial PRIMARY KEY,
  store_transaction_id text NOT NULL UNIQUE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  product_id text NOT NULL,
  platform text,
  kind text NOT NULL,
  credit_kind text CHECK (credit_kind IN ('quote', 'obra')),
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

-- ── 4. Débitos (1 por orçamento/obra — o mesmo nunca debita 2x) ──
CREATE TABLE IF NOT EXISTS public.usage_debits (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('quote', 'obra')),
  ref_id uuid NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  fonte text NOT NULL CHECK (fonte IN ('free', 'credit', 'unlimited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_usage_debits_user ON public.usage_debits (user_id, created_at DESC);
ALTER TABLE public.usage_debits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_debits_own_read ON public.usage_debits;
CREATE POLICY usage_debits_own_read ON public.usage_debits FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ── 5. Ilimitado? (assinatura, PRO antigo ou admin) ──
CREATE OR REPLACE FUNCTION public._billing_unlimited(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.billing_balance b WHERE b.user_id = p_user AND b.unlimited_until > now())
    OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = p_user AND p.is_pro = true
        AND (p.pro_expires_at IS NULL OR p.pro_expires_at > now()
             OR (p.pro_grace_until IS NOT NULL AND p.pro_grace_until > now()))
    )
    OR public.is_portal_admin();
$$;
REVOKE ALL ON FUNCTION public._billing_unlimited(uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. Débito atômico (interno; só as funções abaixo chamam) ──
-- Garante a linha (nasce com os grátis da config), TRAVA ela (FOR
-- UPDATE: dois toques quase juntos não gastam o mesmo crédito) e decide
-- a fonte. Sem saldo → P0402 'quote_balance_empty' / 'obra_balance_empty',
-- e a transação inteira (inclusive o INSERT) é desfeita.
CREATE OR REPLACE FUNCTION public._usage_debit(p_kind text, p_user uuid, p_ref uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.billing_config;
  v_bal public.billing_balance;
  v_free int;
  v_cred int;
  v_fonte text;
BEGIN
  IF p_kind NOT IN ('quote', 'obra') THEN RAISE EXCEPTION 'tipo inválido: %', p_kind; END IF;
  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  IF v_cfg IS NULL OR NOT v_cfg.enforce THEN RETURN 'off'; END IF;

  INSERT INTO public.billing_balance (user_id, free_quotes, free_obras)
  VALUES (p_user, v_cfg.free_quotes, v_cfg.free_obras) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_bal FROM public.billing_balance WHERE user_id = p_user FOR UPDATE;

  IF p_kind = 'quote' THEN v_free := v_bal.free_quotes; v_cred := v_bal.quote_credits;
  ELSE v_free := v_bal.free_obras; v_cred := v_bal.obra_credits; END IF;

  IF public._billing_unlimited(p_user) THEN
    v_fonte := 'unlimited';
  ELSIF v_free > 0 THEN
    v_fonte := 'free';
    IF p_kind = 'quote' THEN
      UPDATE public.billing_balance SET free_quotes = free_quotes - 1, updated_at = now() WHERE user_id = p_user;
    ELSE
      UPDATE public.billing_balance SET free_obras = free_obras - 1, updated_at = now() WHERE user_id = p_user;
    END IF;
  ELSIF v_cred > 0 THEN
    v_fonte := 'credit';
    IF p_kind = 'quote' THEN
      UPDATE public.billing_balance SET quote_credits = quote_credits - 1, updated_at = now() WHERE user_id = p_user;
    ELSE
      UPDATE public.billing_balance SET obra_credits = obra_credits - 1, updated_at = now() WHERE user_id = p_user;
    END IF;
  ELSIF p_kind = 'quote' THEN
    RAISE EXCEPTION 'quote_balance_empty' USING ERRCODE = 'P0402',
      HINT = 'Sem orçamentos disponíveis: compre um pacote ou assine o PRO.';
  ELSE
    RAISE EXCEPTION 'obra_balance_empty' USING ERRCODE = 'P0402',
      HINT = 'Sua obra grátis já foi usada: compre uma obra extra ou assine o PRO.';
  END IF;

  INSERT INTO public.usage_debits (kind, ref_id, user_id, fonte) VALUES (p_kind, p_ref, p_user, v_fonte);
  RETURN v_fonte;
END $$;
REVOKE ALL ON FUNCTION public._usage_debit(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 7. create_painter_draft (Wave 42) + débito ──
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
  PERFORM public._usage_debit('quote', auth.uid(), v_id);
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_painter_draft(text, text, text, numeric, numeric, jsonb) TO authenticated;

-- ── 8. Fecha o INSERT direto do pintor em quotes ──
-- A policy de fallback da Wave 42 deixava o pintor inserir rascunho
-- direto pelo REST — o que pularia o débito. Nenhum código do app faz
-- isso (tudo passa pela RPC); fica só o cliente criando a própria.
DROP POLICY IF EXISTS quotes_insert_participants ON public.quotes;
CREATE POLICY quotes_insert_participants ON public.quotes FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = client_id);

-- ── 9. Obra nova debita (trigger: cobre o app E o REST direto) ──
-- O app cria obra por INSERT direto (RLS de dono), então o débito mora
-- num BEFORE INSERT. O id já tem o default aqui. Admin e service_role
-- passam livres. Só INSERT: editar obra não conta.
CREATE OR REPLACE FUNCTION public.debit_obra_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.is_portal_admin() THEN RETURN NEW; END IF;
  PERFORM public._usage_debit('obra', NEW.owner_id, NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.debit_obra_on_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_debit_obra_on_insert ON public.obras;
CREATE TRIGGER trg_debit_obra_on_insert BEFORE INSERT ON public.obras FOR EACH ROW EXECUTE FUNCTION public.debit_obra_on_insert();

-- ── 10. Saldo do usuário logado (tela/paywall) ──
CREATE OR REPLACE FUNCTION public.my_billing_balance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg public.billing_config;
  v_bal public.billing_balance;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.billing_balance (user_id, free_quotes, free_obras)
  VALUES (v_uid, COALESCE(v_cfg.free_quotes, 5), COALESCE(v_cfg.free_obras, 1)) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_bal FROM public.billing_balance WHERE user_id = v_uid;
  RETURN jsonb_build_object(
    'free_quotes', v_bal.free_quotes,
    'quote_credits', v_bal.quote_credits,
    'free_obras', v_bal.free_obras,
    'obra_credits', v_bal.obra_credits,
    'unlimited_until', v_bal.unlimited_until,
    'unlimited_status', v_bal.unlimited_status,
    'pro_active', public._billing_unlimited(v_uid),
    'enforced', COALESCE(v_cfg.enforce, false)
  );
END $$;
REVOKE ALL ON FUNCTION public.my_billing_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_billing_balance() TO authenticated;

-- ── 11. Crédito de consumível (SÓ service_role, depois de conferir) ──
-- Idempotente pela transação da loja. Mesma transação de novo, mesmo
-- usuário → 'duplicate' (sem crédito). Outro usuário → 'conflict'
-- (token reaproveitado em outra conta: não credita).
CREATE OR REPLACE FUNCTION public.grant_billing_purchase(
  p_user uuid, p_transaction_id text, p_product_id text, p_platform text, p_raw jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind text;
  v_n int;
  v_dono uuid;
  v_cfg public.billing_config;
BEGIN
  IF p_user IS NULL OR COALESCE(p_transaction_id, '') = '' THEN RAISE EXCEPTION 'parâmetros inválidos'; END IF;
  CASE p_product_id
    WHEN 'quote_1' THEN v_kind := 'quote'; v_n := 1;
    WHEN 'quote_pack_40' THEN v_kind := 'quote'; v_n := 40;
    WHEN 'obra_1' THEN v_kind := 'obra'; v_n := 1;
    ELSE RAISE EXCEPTION 'produto não é consumível: %', p_product_id;
  END CASE;

  SELECT user_id INTO v_dono FROM public.billing_events WHERE store_transaction_id = p_transaction_id;
  IF FOUND THEN
    RETURN CASE WHEN v_dono = p_user THEN 'duplicate' ELSE 'conflict' END;
  END IF;

  INSERT INTO public.billing_events (store_transaction_id, user_id, product_id, platform, kind, credit_kind, credits_granted, raw)
  VALUES (p_transaction_id, p_user, p_product_id, p_platform, 'purchase', v_kind, v_n, p_raw)
  ON CONFLICT (store_transaction_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.billing_balance (user_id, free_quotes, free_obras)
  VALUES (p_user, COALESCE(v_cfg.free_quotes, 5), COALESCE(v_cfg.free_obras, 1)) ON CONFLICT (user_id) DO NOTHING;
  IF v_kind = 'quote' THEN
    UPDATE public.billing_balance SET quote_credits = quote_credits + v_n, updated_at = now() WHERE user_id = p_user;
  ELSE
    UPDATE public.billing_balance SET obra_credits = obra_credits + v_n, updated_at = now() WHERE user_id = p_user;
  END IF;
  RETURN 'granted';
END $$;
REVOKE ALL ON FUNCTION public.grant_billing_purchase(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_billing_purchase(uuid, text, text, text, jsonb) TO service_role;

-- ── 12. Reembolso de consumível (SÓ service_role) ──
-- Tira os créditos que a transação deu (sem ficar negativo — o que já
-- foi gasto não volta). Idempotente.
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
    IF v_ev.credit_kind = 'quote' THEN
      UPDATE public.billing_balance SET quote_credits = GREATEST(quote_credits - v_ev.credits_granted, 0), updated_at = now() WHERE user_id = v_ev.user_id;
    ELSIF v_ev.credit_kind = 'obra' THEN
      UPDATE public.billing_balance SET obra_credits = GREATEST(obra_credits - v_ev.credits_granted, 0), updated_at = now() WHERE user_id = v_ev.user_id;
    END IF;
  END IF;
  RETURN 'revoked';
END $$;
REVOKE ALL ON FUNCTION public.revoke_billing_purchase(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_billing_purchase(text, jsonb) TO service_role;

-- ── 13. Estado da assinatura PRO (SÓ service_role) ──
-- Chamado a cada evento da loja (compra, renovação, cancelamento,
-- expiração, carência, reembolso). Grava a DATA DE FIM que a loja
-- informa: cancelado continua valendo até lá; reembolso/expirado manda
-- uma data passada (ou NULL). Idempotente pelo id do evento.
-- A assinatura é o PRO de verdade: espelha a data em profiles.is_pro /
-- pro_expires_at, então toda trava de PRO que já existe (rotas de IA,
-- Agenda, Anotações, selo do topo) enxerga a assinatura sem mudar nada.
-- PRO dado à mão SEM data nunca é tocado; PRO com data mais longa que a
-- assinatura não encolhe.
CREATE OR REPLACE FUNCTION public.set_pro_subscription(
  p_user uuid, p_event_id text, p_until timestamptz, p_status text, p_platform text, p_raw jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dono uuid;
  v_cfg public.billing_config;
  v_antes timestamptz;
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

  SELECT unlimited_until INTO v_antes FROM public.billing_balance WHERE user_id = p_user;

  SELECT * INTO v_cfg FROM public.billing_config WHERE id = 1;
  INSERT INTO public.billing_balance (user_id, free_quotes, free_obras, unlimited_until, unlimited_status)
  VALUES (p_user, COALESCE(v_cfg.free_quotes, 5), COALESCE(v_cfg.free_obras, 1), p_until, p_status)
  ON CONFLICT (user_id) DO UPDATE SET unlimited_until = p_until, unlimited_status = p_status, updated_at = now();

  IF p_until IS NOT NULL AND p_until > now() THEN
    -- Ativa/renova: liga o PRO até o fim informado pela loja.
    UPDATE public.profiles SET
      is_pro = true,
      pro_expires_at = CASE
        WHEN is_pro = true AND pro_expires_at IS NULL THEN NULL      -- PRO manual sem data: intocado
        ELSE GREATEST(COALESCE(pro_expires_at, p_until), p_until)
      END
    WHERE id = p_user;
  ELSE
    -- Expirou/reembolso: só recua a data que a PRÓPRIA assinatura deu.
    -- PRO manual sem data, ou com data além da assinatura, fica.
    UPDATE public.profiles SET pro_expires_at = COALESCE(p_until, now())
    WHERE id = p_user
      AND pro_expires_at IS NOT NULL
      AND v_antes IS NOT NULL
      AND pro_expires_at <= v_antes;
  END IF;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION public.set_pro_subscription(uuid, text, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_pro_subscription(uuid, text, timestamptz, text, text, jsonb) TO service_role;

-- ── Conferência (uma linha por item, ok = true) ──
SELECT 'billing_config (cobrança desligada)' AS item, EXISTS (SELECT 1 FROM public.billing_config WHERE id = 1 AND enforce = false) AS ok
UNION ALL SELECT 'billing_balance com RLS', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_balance'::regclass)
UNION ALL SELECT 'billing_events com RLS', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_events'::regclass)
UNION ALL SELECT 'usage_debits com RLS', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.usage_debits'::regclass)
UNION ALL SELECT 'create_painter_draft debita', (SELECT prosrc LIKE '%_usage_debit%' FROM pg_proc WHERE oid = 'public.create_painter_draft(text,text,text,numeric,numeric,jsonb)'::regprocedure)
UNION ALL SELECT 'obra nova debita', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_debit_obra_on_insert' AND NOT tgisinternal)
UNION ALL SELECT 'authenticated NÃO credita', NOT has_function_privilege('authenticated', 'public.grant_billing_purchase(uuid,text,text,text,jsonb)', 'EXECUTE')
UNION ALL SELECT 'authenticated NÃO debita direto', NOT has_function_privilege('authenticated', 'public._usage_debit(text,uuid,uuid)', 'EXECUTE')
UNION ALL SELECT 'assinatura liga o PRO', (SELECT prosrc LIKE '%is_pro = true%' FROM pg_proc WHERE oid = 'public.set_pro_subscription(uuid,text,timestamptz,text,text,jsonb)'::regprocedure)
UNION ALL SELECT 'pintor não insere quote direto', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotes' AND policyname = 'quotes_insert_participants' AND with_check NOT LIKE '%painter_id%');
