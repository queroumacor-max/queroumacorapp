-- ════════════════════════════════════════════════════════════════════
-- Compras in-app, parte 2 (teste grátis das IAs) — 2026-10-25. Roda DEPOIS de
-- 2026-10-25-billing-balance.sql.
--
-- Teste grátis das IAs (decisão do usuário): quem não é PRO ganha 1 uso
-- de cada ferramenta por conta, pra sempre; Seu Zé/Fê/Senna 3 mensagens
-- no total. A Alice (cliente) não entra aqui: segue com o limite de 3
-- perguntas por dia que já tinha. Contado no servidor (reinstalar o app
-- não dá outra chance). Só service_role chama. A regra (quantos usos por
-- ferramenta) mora em next-app/lib/aiTrial.ts.
--
-- Idempotente: pode rodar de novo.
-- ════════════════════════════════════════════════════════════════════

-- ── Teste grátis das IAs ──
-- period = 'ever' (pra sempre) ou 'AAAA-MM' (mês de Brasília).
CREATE TABLE IF NOT EXISTS public.ai_trial_usage (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feature text NOT NULL,
  period text NOT NULL,
  used int NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature, period)
);
ALTER TABLE public.ai_trial_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_trial_usage_own_read ON public.ai_trial_usage;
CREATE POLICY ai_trial_usage_own_read ON public.ai_trial_usage FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Reserva atômica de 1 uso grátis. Dois pedidos juntos não passam do
-- teto: o UPDATE só soma enquanto used < limite.
CREATE OR REPLACE FUNCTION public.claim_ai_trial(p_user uuid, p_feature text, p_limit int, p_monthly boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period text;
  v_used int;
BEGIN
  IF p_user IS NULL OR COALESCE(p_feature, '') = '' OR p_limit IS NULL OR p_limit < 1 THEN
    RETURN jsonb_build_object('allowed', false, 'used', 0, 'limit', COALESCE(p_limit, 0));
  END IF;
  v_period := CASE WHEN p_monthly THEN to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') ELSE 'ever' END;

  INSERT INTO public.ai_trial_usage (user_id, feature, period, used)
  VALUES (p_user, p_feature, v_period, 1)
  ON CONFLICT (user_id, feature, period) DO UPDATE
    SET used = public.ai_trial_usage.used + 1, updated_at = now()
    WHERE public.ai_trial_usage.used < p_limit
  RETURNING used INTO v_used;

  IF v_used IS NULL THEN
    SELECT used INTO v_used FROM public.ai_trial_usage WHERE user_id = p_user AND feature = p_feature AND period = v_period;
    RETURN jsonb_build_object('allowed', false, 'used', COALESCE(v_used, p_limit), 'limit', p_limit);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
END $$;
REVOKE ALL ON FUNCTION public.claim_ai_trial(uuid, text, int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_trial(uuid, text, int, boolean) TO service_role;

-- ── Conferência (uma linha por item, ok = true) ──
SELECT 'ai_trial_usage com RLS' AS item, (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_trial_usage'::regclass) AS ok
UNION ALL SELECT 'authenticated NÃO reserva teste', NOT has_function_privilege('authenticated', 'public.claim_ai_trial(uuid,text,int,boolean)', 'EXECUTE')
UNION ALL SELECT 'service_role reserva teste', has_function_privilege('service_role', 'public.claim_ai_trial(uuid,text,int,boolean)', 'EXECUTE');
