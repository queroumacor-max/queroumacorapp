-- ============================================
-- Feature 4 — Denúncia de post
-- Registra denúncias de posts feitas pelos usuários para análise da equipe.
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ============================================

-- 1) Tabela de denúncias ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid,
  target_user_id uuid,
  reason text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- 2) Policies --------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'Users can insert own reports'
  ) THEN
    CREATE POLICY "Users can insert own reports" ON public.reports
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'Users can view own reports'
  ) THEN
    CREATE POLICY "Users can view own reports" ON public.reports
      FOR SELECT TO authenticated USING (auth.uid() = reporter_id);
  END IF;
END $$;

-- 3) Índice ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON public.reports(status, created_at);
