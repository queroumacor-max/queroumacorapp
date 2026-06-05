-- SQL Wave 9 (2026-06-05) — admin pode apagar/atualizar qualquer comment
-- ─────────────────────────────────────────────────────────────────────────
-- Motivação: o user reportou que ao clicar "Apagar" num comentário de
-- outro usuário em post próprio, o comment não sumia. Investigação
-- mostrou que a policy "Post owners can delete comments" exige
-- (post.user_id = auth.uid()) — funciona pro dono do post deletar
-- comments alheios, MAS:
--   1. Admin não tinha override pra moderação geral
--   2. Soft-delete (UPDATE deleted_at) não tinha policy NENHUMA, então
--      ninguém conseguia setar deleted_at via cliente
--
-- Esta migration adiciona 2 policies admin-only:
--   - DELETE: admin pode hard-deletar qualquer comment
--   - UPDATE: admin pode soft-deletar (UPDATE deleted_at) ou editar
--     qualquer comment (pra moderação)
--
-- Não afeta as policies existentes — são policies permissivas adicionais
-- (Postgres RLS OR'a permissivas).

DROP POLICY IF EXISTS "Admins can delete any comment" ON public.comments;
CREATE POLICY "Admins can delete any comment" ON public.comments
  FOR DELETE TO authenticated
  USING (public.is_portal_admin());

DROP POLICY IF EXISTS "Admins can update any comment" ON public.comments;
CREATE POLICY "Admins can update any comment" ON public.comments
  FOR UPDATE TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());
