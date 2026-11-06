-- Avisos do portal com foto/vídeo (2026-11-06).
-- Uma instrução por linha (colagem pelo celular). Idempotente.
-- A view ganha as colunas no FIM (CREATE OR REPLACE VIEW só aceita acrescentar).
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS media_type text;
CREATE OR REPLACE VIEW public.announcements_public WITH (security_invoker = true) AS SELECT id, title, message, active, created_at, media_url, media_type FROM public.announcements;
GRANT SELECT ON public.announcements_public TO anon, authenticated;
-- Conferência (as 2 linhas devem voltar ok = true):
SELECT 'colunas' AS item, count(*) = 2 AS ok FROM information_schema.columns WHERE table_schema='public' AND table_name='announcements' AND column_name IN ('media_url','media_type') UNION ALL SELECT 'view', count(*) = 2 FROM information_schema.columns WHERE table_schema='public' AND table_name='announcements_public' AND column_name IN ('media_url','media_type');
