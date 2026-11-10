-- Vagas só pra PRO (decisão do usuário, 2026-11-10). A tela já esconde; esta
-- policy é o que barra de verdade a leitura direta pela API. Admin do portal
-- segue lendo tudo pela policy de admin. Idempotente.
DROP POLICY IF EXISTS oportunidades_vaga_ativa_select ON public.oportunidades;
CREATE POLICY oportunidades_vaga_ativa_select ON public.oportunidades FOR SELECT TO authenticated USING (tipo = 'vaga' AND status = 'ativa' AND (SELECT public.is_pro_active(auth.uid())));

-- Conferência: deve voltar ok = true.
SELECT 'vaga ativa so pra PRO' AS item, EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oportunidades' AND policyname = 'oportunidades_vaga_ativa_select' AND qual LIKE '%is_pro_active%') AS ok;
