-- SQL Wave 12 (2026-06-06) — recuperação: garante SELECT policies em comments
-- ──────────────────────────────────────────────────────────────────────────
-- Wave 11 dropou "Comments are viewable by everyone" (USING true). Se o
-- banco do user NÃO tinha as policies das Wave 3 ("comments_select_auth")
-- e Wave 8 ("View comments active") por algum motivo (migration nunca
-- rodada, drop manual), o user ficou SEM nenhuma policy de SELECT —
-- todos os SELECTs em comments retornam 0 rows silenciosamente.
--
-- Sintoma: comments somem da UI sem toast (RLS silenciosamente bloqueia
-- — não é erro do PostgREST, é deny implícito).
--
-- Esta migration é idempotente: recria as 2 policies que devem estar
-- presentes. Pode rodar várias vezes.

DROP POLICY IF EXISTS "comments_select_auth" ON public.comments;
CREATE POLICY "comments_select_auth" ON public.comments
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "View comments active" ON public.comments;
CREATE POLICY "View comments active" ON public.comments
  FOR SELECT USING (
    deleted_at IS NULL
    OR user_id = auth.uid()
    OR public.is_portal_admin()
  );

-- Defensivo: confirma o drop da public-everyone (no-op se já foi)
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
