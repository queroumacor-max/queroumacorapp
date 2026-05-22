-- ============================================
-- Feature 2 — mini-CRM de follow-up (reativação de clientes)
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ============================================

-- 1) Tabela crm_clients -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  painter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_name text,
  client_phone text,
  is_app_user boolean DEFAULT false,
  followup_optin boolean DEFAULT false,
  optin_source text,
  optin_at timestamptz,
  last_service_at date,
  last_service_desc text,
  total_value numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.crm_clients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'crm_clients' AND policyname = 'Painters can manage own crm clients'
  ) THEN
    CREATE POLICY "Painters can manage own crm clients" ON public.crm_clients
      FOR ALL TO authenticated USING (auth.uid() = painter_id) WITH CHECK (auth.uid() = painter_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_clients_painter ON public.crm_clients(painter_id);

-- 2) Novas colunas em follow_ups ---------------------------------------
DO $$
BEGIN
  BEGIN ALTER TABLE public.follow_ups ADD COLUMN crm_client_id uuid; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.follow_ups ADD COLUMN channel text; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- 3) Intervalo de follow-up em profiles --------------------------------
DO $$
BEGIN
  BEGIN ALTER TABLE public.profiles ADD COLUMN followup_interval_months int DEFAULT 12; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- 4) Opt-in de follow-up capturado na aprovação do orçamento -----------
DO $$
BEGIN
  BEGIN ALTER TABLE public.quotes ADD COLUMN client_followup_optin boolean DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;
