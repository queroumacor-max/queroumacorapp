-- ============================================================
-- BATERIA 2 — SEGURANÇA: RPCs + cleanup conservador de policies
-- ============================================================
-- Idempotente: rode quantas vezes quiser. CREATE OR REPLACE, DROP IF EXISTS.
-- NÃO muda comportamento da UI. Só:
--   • PART B: cria 3 RPCs SECURITY DEFINER (ainda não usadas pelo cliente)
--   • PART C: dropa policies duplicadas (cosméticas, mesmo efeito da que sobra)
--   • PART D: tighten agressivo (COMENTADO — rodar só depois de migrar cliente)
-- ============================================================

-- ============================================================
-- PART B — RPCs SECURITY DEFINER
-- ============================================================
-- Vantagem: o cliente chama via sb.rpc('nome', {...}) e as regras
-- (quem pode, com que dados, sem duplicar, com saldo, etc) rodam no
-- servidor com privilégio da função — o cliente não consegue burlar.

-- 1) create_quote_from_post — insere quote forçando client_id=auth.uid()
DROP FUNCTION IF EXISTS public.create_quote_from_post(
  uuid, uuid, text, text, numeric, text, text, date, jsonb, text
);
CREATE OR REPLACE FUNCTION public.create_quote_from_post(
  p_painter_id    uuid,
  p_post_id       uuid,
  p_title         text,
  p_service_type  text,
  p_area_m2       numeric,
  p_address       text,
  p_description   text,
  p_proposed_date date,
  p_images        jsonb DEFAULT '[]'::jsonb,
  p_lead_type     text  DEFAULT 'direct'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para solicitar orçamento';
  END IF;
  IF p_painter_id IS NULL THEN
    RAISE EXCEPTION 'painter_id obrigatório';
  END IF;
  IF p_painter_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode pedir orçamento para si mesmo';
  END IF;

  INSERT INTO public.quotes (
    client_id, painter_id, title, service_type, area_m2, address,
    description, proposed_date, images, lead_type, status, created_at
  ) VALUES (
    auth.uid(), p_painter_id,
    COALESCE(NULLIF(TRIM(p_title), ''), 'Orçamento'),
    COALESCE(NULLIF(TRIM(p_service_type), ''), 'pintura'),
    p_area_m2, p_address, p_description, p_proposed_date,
    COALESCE(p_images, '[]'::jsonb),
    COALESCE(NULLIF(TRIM(p_lead_type), ''), 'direct'),
    'pending', now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_quote_from_post(
  uuid, uuid, text, text, numeric, text, text, date, jsonb, text
) TO authenticated;

-- 2) submit_review — valida quote + sem duplicata
DROP FUNCTION IF EXISTS public.submit_review(uuid, uuid, integer, text, jsonb);
CREATE OR REPLACE FUNCTION public.submit_review(
  p_quote_id   uuid,
  p_painter_id uuid,
  p_rating     integer,
  p_comment    text  DEFAULT NULL,
  p_criteria   jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_quote_owner   uuid;
  v_quote_painter uuid;
  v_dup integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para avaliar';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Nota tem que ser de 1 a 5';
  END IF;

  IF p_quote_id IS NOT NULL THEN
    SELECT client_id, painter_id INTO v_quote_owner, v_quote_painter
      FROM public.quotes WHERE id = p_quote_id;
    IF v_quote_owner IS NULL THEN
      RAISE EXCEPTION 'Orçamento não encontrado';
    END IF;
    IF v_quote_owner != auth.uid() THEN
      RAISE EXCEPTION 'Você só pode avaliar os próprios orçamentos';
    END IF;
    IF p_painter_id IS NOT NULL AND v_quote_painter IS NOT NULL
       AND p_painter_id != v_quote_painter THEN
      RAISE EXCEPTION 'Painter informado não bate com o do orçamento';
    END IF;

    -- Anti-duplicata
    SELECT COUNT(*) INTO v_dup FROM public.reviews
     WHERE quote_id = p_quote_id AND reviewer_id = auth.uid();
    IF v_dup > 0 THEN
      RAISE EXCEPTION 'Você já avaliou este orçamento';
    END IF;
  END IF;

  INSERT INTO public.reviews (
    reviewer_id, quote_id, rating, comment, criteria, created_at
  ) VALUES (
    auth.uid(), p_quote_id, p_rating, p_comment,
    COALESCE(p_criteria, '[]'::jsonb), now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_review(
  uuid, uuid, integer, text, jsonb
) TO authenticated;

-- 3) redeem_pro_with_points — troca 100 pts por 1 mês PRO ATÔMICO
--    Substitui a lógica frágil em app.js trocarPontosPorPRO() que hoje
--    deixa o cliente fazer UPDATE direto em profiles.is_pro (😱).
DROP FUNCTION IF EXISTS public.redeem_pro_with_points(integer);
CREATE OR REPLACE FUNCTION public.redeem_pro_with_points(
  p_cost integer DEFAULT 100
) RETURNS timestamptz  -- nova data de expiração do PRO
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer := 0;
  v_current_exp timestamptz;
  v_new_exp timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login';
  END IF;
  IF p_cost IS NULL OR p_cost < 1 THEN
    RAISE EXCEPTION 'Custo inválido';
  END IF;

  -- Saldo: earned - (spent|redeemed)
  SELECT COALESCE(SUM(
    CASE WHEN type = 'earned' THEN amount ELSE -amount END
  ), 0) INTO v_balance
    FROM public.points WHERE user_id = auth.uid();

  IF v_balance < p_cost THEN
    RAISE EXCEPTION 'Saldo insuficiente (tem %, precisa %)', v_balance, p_cost;
  END IF;

  -- Calcula nova data de expiração (estende se ainda ativo)
  SELECT pro_expires_at INTO v_current_exp
    FROM public.profiles WHERE id = auth.uid();
  v_new_exp := COALESCE(
    CASE WHEN v_current_exp > now() THEN v_current_exp ELSE now() END,
    now()
  ) + interval '30 days';

  -- Débito + ativação em transação
  INSERT INTO public.points (user_id, amount, type, source, created_at)
  VALUES (auth.uid(), p_cost, 'redeemed', 'pro_1mes', now());

  UPDATE public.profiles
     SET is_pro = true, pro_expires_at = v_new_exp
   WHERE id = auth.uid();

  RETURN v_new_exp;
END $$;

GRANT EXECUTE ON FUNCTION public.redeem_pro_with_points(integer) TO authenticated;

-- ============================================================
-- PART C — CLEANUP DE POLICIES DUPLICADAS (sem mudar comportamento)
-- ============================================================
-- Só dropa as que têm um par com mesmíssimo efeito. Não tighten.

-- reviews: 2 SELECTs públicos + 2 INSERTs próprios = duplicatas exatas
DROP POLICY IF EXISTS "Reviews viewable by everyone" ON public.reviews;
DROP POLICY IF EXISTS "Users can create reviews"     ON public.reviews;
-- (mantém: reviews_public_read + reviews_own_insert — mesmo efeito)

-- quotes: 2 SELECTs públicos idênticos
DROP POLICY IF EXISTS "Quotes are viewable by everyone" ON public.quotes;
-- (mantém: "Quotes viewable by everyone" — TODO em PART D: trocar por estrito)

-- ============================================================
-- PART D — TIGHTENING (COMENTADO — só rodar depois de migrar cliente)
-- ============================================================
-- Estas mudanças QUEBRAM funcionalidades hoje (porque o cliente ainda
-- insere quote/review/notification direto na tabela). Rodar SÓ depois
-- que eu migrar o app.js para usar as RPCs acima.
--
-- Quando for a hora, descomente este bloco inteiro e rode:
--
-- -- quotes: derrubar todos os INSERTs permissivos, deixar só via RPC
-- DROP POLICY IF EXISTS "Users can insert quotes"        ON public.quotes;
-- DROP POLICY IF EXISTS "Users can insert own quotes"    ON public.quotes;
-- DROP POLICY IF EXISTS "Painters can insert own quotes" ON public.quotes;
-- DROP POLICY IF EXISTS "quotes_client_insert"           ON public.quotes;
-- -- (nenhum INSERT direto sobra — só create_quote_from_post)
--
-- -- quotes: SELECT só para as partes do quote (não mais público)
-- DROP POLICY IF EXISTS "Quotes viewable by everyone" ON public.quotes;
-- -- (mantém: quotes_own_read)
--
-- -- reviews: idem (insert só via submit_review)
-- DROP POLICY IF EXISTS "reviews_own_insert" ON public.reviews;
--
-- -- notifications: dropar a INSERT permissiva (qualquer logado spam)
-- DROP POLICY IF EXISTS "Authenticated can create notifications" ON public.notifications;
-- DROP POLICY IF EXISTS "Users can create notifications"         ON public.notifications;
-- -- (criar RPC notify_user e usar dela em vez de INSERT direto)
--
-- -- profiles: impedir cliente de setar is_pro/pro_expires_at direto
-- -- (já bloqueado por implícito? checar com SELECT * FROM pg_policies)

-- ============================================================
-- DIAGNÓSTICO FINAL — rode pra confirmar
-- ============================================================
SELECT routine_name FROM information_schema.routines
 WHERE routine_schema = 'public'
   AND routine_name IN (
     'is_portal_admin','award_referral_points','recalc_painter_rating',
     'create_quote_from_post','submit_review','redeem_pro_with_points'
   )
 ORDER BY routine_name;

SELECT tablename, COUNT(*) AS policy_count
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('reviews','quotes','notifications','referrals','points')
 GROUP BY tablename ORDER BY tablename;

NOTIFY pgrst, 'reload schema';
