-- SQL Wave 26 (2026-06-10) — biblioteca de artes de grafiteiro/pintor
-- ────────────────────────────────────────────────────────────────────────
-- Sprint 1 da feature "AR Grafite": pintor sobe arte uma vez, reusa em
-- várias paredes. Sprint 2 conecta a biblioteca ao WallARView pra
-- overlay AR com drag/pinch/rotate.

CREATE TABLE IF NOT EXISTS public.art_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  image_url text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  width int,
  height int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_art_references_user_created
  ON public.art_references (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_art_references_tags_gin
  ON public.art_references USING gin(tags);

-- Trigger updated_at (reusa set_updated_at já criado em wave 25)
DROP TRIGGER IF EXISTS trg_art_references_updated_at ON public.art_references;
CREATE TRIGGER trg_art_references_updated_at
  BEFORE UPDATE ON public.art_references
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.art_references ENABLE ROW LEVEL SECURITY;

-- Owner-only por padrão (arte é privada do pintor). Compartilhamento
-- com cliente fica como follow-up.
DROP POLICY IF EXISTS art_references_owner ON public.art_references;
CREATE POLICY art_references_owner
  ON public.art_references
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── Bucket de storage ──────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'art-refs',
  'art-refs',
  true,  -- read público via URL (paths são UUID random; sem enumeração)
  20971520,  -- 20MB por upload
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = EXCLUDED.public;

-- Path pattern: art-refs/{user_id}/{uuid}.{ext}
-- Owner write/delete: primeira folder do name precisa ser auth.uid().
DROP POLICY IF EXISTS "art-refs owner write" ON storage.objects;
CREATE POLICY "art-refs owner write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'art-refs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "art-refs owner update" ON storage.objects;
CREATE POLICY "art-refs owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'art-refs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "art-refs owner delete" ON storage.objects;
CREATE POLICY "art-refs owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'art-refs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "art-refs public read" ON storage.objects;
CREATE POLICY "art-refs public read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'art-refs');
