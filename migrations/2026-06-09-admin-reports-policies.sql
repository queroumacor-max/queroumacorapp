-- SQL Wave 18 (2026-06-09) — policies de admin pra tabela reports
-- ──────────────────────────────────────────────────────────────────
-- O3 do BACKLOG.md. A tabela `reports` (Wave 4) hoje tem RLS só pra
-- reporter ver/inserir as próprias denúncias. Sem policy de admin,
-- a tela `/admin/reports` não consegue listar nada (e o admin
-- precisa abrir o SQL Editor pra ver/resolver denúncias — não
-- escala).
--
-- Adiciona:
--   - Policy SELECT pra admin (via is_portal_admin()) — lê tudo
--   - Policy UPDATE pra admin (via is_portal_admin()) — muda status
--
-- is_portal_admin() já existe (Wave 5+). Convive com as policies
-- restritivas existentes via OR (qualquer policy que dá USING/CHECK
-- true permite acesso).

DROP POLICY IF EXISTS "reports_select_admin" ON public.reports;
CREATE POLICY "reports_select_admin" ON public.reports FOR SELECT TO authenticated
  USING (public.is_portal_admin());

DROP POLICY IF EXISTS "reports_update_admin" ON public.reports;
CREATE POLICY "reports_update_admin" ON public.reports FOR UPDATE TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());
