-- ============================================
-- Feature 3 — Slot "coming soon" de maquininha de cartão
-- Medição de interesse por features futuras (zero processamento de pagamento).
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ============================================

-- 1) Tabela de interesse em features --------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_interest (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text,
  action text,
  contact text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.feature_interest ENABLE ROW LEVEL SECURITY;

-- 2) Policies --------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'feature_interest' AND policyname = 'Users can insert own feature interest'
  ) THEN
    CREATE POLICY "Users can insert own feature interest" ON public.feature_interest
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'feature_interest' AND policyname = 'Users can view own feature interest'
  ) THEN
    CREATE POLICY "Users can view own feature interest" ON public.feature_interest
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- 3) Índice ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_feature_interest_feature_action ON public.feature_interest(feature, action);
