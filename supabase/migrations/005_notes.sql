-- ============================================
-- Anotações do pintor (notas e lembretes)
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ============================================

CREATE TABLE IF NOT EXISTS public.notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  body text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can manage own notes'
  ) THEN
    CREATE POLICY "Users can manage own notes" ON public.notes
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notes_user ON public.notes(user_id, created_at DESC);
