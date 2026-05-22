-- ============================================
-- Feature 1 — Aprovação de orçamento
-- Ciclo: rascunho -> enviado -> aprovado -> em_execucao -> concluido (+ recusado)
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ============================================

-- 1) Novas colunas em quotes ---------------------------------------------
DO $$
BEGIN
  BEGIN ALTER TABLE public.quotes ADD COLUMN sent_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN approved_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN approved_by uuid; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN approval_method text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN approval_note text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN scope_snapshot jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN quote_data jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN client_name text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN client_phone text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN completed_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- 2) Policy: o pintor também pode inserir orçamentos (hoje só o client_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'quotes' AND policyname = 'Painters can insert own quotes'
  ) THEN
    CREATE POLICY "Painters can insert own quotes" ON public.quotes
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = painter_id);
  END IF;
END $$;

-- 3) Tabela de notificações in-app --------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY
);

-- Garante todas as colunas mesmo se a tabela 'notifications' já existia
-- de antes (sem essas colunas).
DO $$
BEGIN
  BEGIN ALTER TABLE public.notifications ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.notifications ADD COLUMN actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.notifications ADD COLUMN type text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.notifications ADD COLUMN title text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.notifications ADD COLUMN body text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.notifications ADD COLUMN ref_id uuid; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.notifications ADD COLUMN read boolean DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.notifications ADD COLUMN created_at timestamptz DEFAULT now(); EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can view own notifications'
  ) THEN
    CREATE POLICY "Users can view own notifications" ON public.notifications
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can update own notifications'
  ) THEN
    CREATE POLICY "Users can update own notifications" ON public.notifications
      FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Authenticated can create notifications'
  ) THEN
    CREATE POLICY "Authenticated can create notifications" ON public.notifications
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);
