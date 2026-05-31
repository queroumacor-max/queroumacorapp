-- 2026-05-31-payments-hardening.sql
-- Hardening pagamentos/subscription (Pagamentos#11, #17, #18, #19):
--   1. Tabela `invoices` (rastreio de cada cobrança/refund pra conciliação)
--   2. Grace period 3 dias via `profiles.pro_grace_until`
--   3. `ai_usage` table + counter mensal por feature
--   4. `plan_limits` table (limite mensal de IA por plano: free=30, pro=500, admin=99999)
--
-- Idempotente — pode rodar 2x sem efeito colateral (IF NOT EXISTS, ON CONFLICT).
--
-- Convive com schema existente em supabase_init.sql:
--   - profiles.is_pro (boolean, default false)
--   - profiles.pro_expires_at (timestamptz)
--   - protect_profile_columns trigger (SQL Wave 3) impede escalada via INSERT;
--     mexer em pro_grace_until precisa rodar pelo path service_role (webhook).

BEGIN;

-- ─── 1. Invoices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_id text UNIQUE NOT NULL,
  provider text NOT NULL DEFAULT 'mercadopago',
  type text NOT NULL CHECK (type IN ('subscription', 'order', 'refund')),
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  metadata jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_user ON public.invoices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status_pending ON public.invoices(status) WHERE status IN ('pending', 'failed');

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Drop+create pra ser idempotente caso a policy já exista de uma execução parcial.
DROP POLICY IF EXISTS "Users read own invoices" ON public.invoices;
CREATE POLICY "Users read own invoices"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT/UPDATE só via service_role (mp-webhook), nunca via PostgREST direto.
-- Sem policy de INSERT/UPDATE → RLS deny by default pra `authenticated`.

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.invoices_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_set_updated_at();

-- ─── 2. Grace period ──────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_grace_until timestamptz;

-- Helper RPC: PRO ativo se is_pro=true E (expires futuro OU grace futuro).
-- Usado por canSeeProFeature server-side (policies.ts + requirePro).
CREATE OR REPLACE FUNCTION public.is_pro_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND is_pro = true
      AND (
        pro_expires_at IS NULL
        OR pro_expires_at > now()
        OR (pro_grace_until IS NOT NULL AND pro_grace_until > now())
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_pro_active(uuid) TO authenticated, anon, service_role;

-- ─── 3. AI usage tracking ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (feature IN (
    'chat_ai', 'caption', 'transcribe', 'tts', 'generate_logo',
    'area_from_photo', 'pricing_suggest', 'fin_analysis', 'crm_draft',
    'agenda_order', 'resolve_color', 'moderate', 'moderate_video', 'ig_art'
  )),
  used_at timestamptz NOT NULL DEFAULT now(),
  cost_units int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_monthly ON public.ai_usage(user_id, feature, used_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_month ON public.ai_usage(user_id, used_at);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own ai_usage" ON public.ai_usage;
CREATE POLICY "Users read own ai_usage"
  ON public.ai_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT só via service_role (route handlers de IA), nunca pelo browser.
-- Sem policy de INSERT → RLS deny by default pra authenticated/anon.

-- ─── 4. Plan limits ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan text PRIMARY KEY,
  ai_monthly_limit int NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO public.plan_limits (plan, ai_monthly_limit, features) VALUES
  ('free',  30,    '{"chat_ai": true, "caption": true, "moderate": true}'::jsonb),
  ('pro',   500,   '{}'::jsonb),
  ('admin', 99999, '{}'::jsonb)
ON CONFLICT (plan) DO NOTHING;

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

-- Plan limits são públicos pra leitura (UI mostra "X/Y usos este mês").
DROP POLICY IF EXISTS "Public read plan_limits" ON public.plan_limits;
CREATE POLICY "Public read plan_limits"
  ON public.plan_limits
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- ─── 5. Helper RPC: contagem do mês corrente ──────────────────────────────
-- Usado por canUseAi() pra decidir limite. STABLE pra cacheado dentro da
-- transação (não muda enquanto a query roda).
CREATE OR REPLACE FUNCTION public.ai_usage_this_month(p_user_id uuid, p_feature text DEFAULT NULL)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_units), 0)::int FROM public.ai_usage
  WHERE user_id = p_user_id
    AND used_at >= date_trunc('month', now())
    AND (p_feature IS NULL OR feature = p_feature);
$$;

GRANT EXECUTE ON FUNCTION public.ai_usage_this_month(uuid, text) TO authenticated, service_role;

-- ─── 6. Trigger: invoice paid → estende PRO ───────────────────────────────
-- Quando uma invoice de subscription vai pra 'paid', estende pro_expires_at
-- em 30 dias e zera grace. Idempotente: só roda se a transição for "→ paid"
-- (OLD não era paid; NEW é paid).
CREATE OR REPLACE FUNCTION public.handle_invoice_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.type = 'subscription'
     AND NEW.user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE public.profiles
    SET is_pro = true,
        pro_expires_at = GREATEST(COALESCE(pro_expires_at, now()), now()) + interval '30 days',
        pro_grace_until = NULL
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_paid ON public.invoices;
CREATE TRIGGER trg_invoice_paid
  AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_invoice_paid();

-- ─── 7. Helper: registrar invoice (usado pelo mp-webhook port TS) ─────────
-- Centraliza idempotência por external_id. ON CONFLICT permite re-entrega do
-- webhook sem duplicar linhas. Atualiza status/paid_at em re-entrega.
CREATE OR REPLACE FUNCTION public.upsert_invoice(
  p_user_id uuid,
  p_external_id text,
  p_provider text,
  p_type text,
  p_amount numeric,
  p_currency text,
  p_status text,
  p_metadata jsonb DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL
) RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.invoices;
BEGIN
  INSERT INTO public.invoices (
    user_id, external_id, provider, type, amount, currency, status, metadata, paid_at
  ) VALUES (
    p_user_id, p_external_id, p_provider, p_type, p_amount, p_currency, p_status, p_metadata, p_paid_at
  )
  ON CONFLICT (external_id) DO UPDATE
    SET status   = EXCLUDED.status,
        paid_at  = COALESCE(EXCLUDED.paid_at, public.invoices.paid_at),
        metadata = COALESCE(EXCLUDED.metadata, public.invoices.metadata),
        amount   = EXCLUDED.amount,
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_invoice(uuid, text, text, text, numeric, text, text, jsonb, timestamptz) TO service_role;

COMMIT;
