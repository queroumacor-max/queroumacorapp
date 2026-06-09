-- SQL Wave 19 (2026-06-09) — policy admin pra feature_interest
-- ────────────────────────────────────────────────────────────────
-- O2 do BACKLOG.md. A tabela `feature_interest` (Wave 4) coleta cliques
-- em features "em breve" (ex.: Maquininha) mas só tem RLS de INSERT
-- pra authenticated. Sem SELECT pra admin, não dá pra ver quem
-- demonstrou interesse — escolha de produto fica cega.
--
-- Adiciona SELECT pra admin via is_portal_admin(). Não precisa UPDATE
-- nem DELETE — feature_interest é append-only do ponto de vista de
-- produto (CRUD não faz sentido).

DROP POLICY IF EXISTS "feature_interest_select_admin" ON public.feature_interest;
CREATE POLICY "feature_interest_select_admin" ON public.feature_interest FOR SELECT TO authenticated
  USING (public.is_portal_admin());
