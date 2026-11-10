-- 2026-11-10 — "vamos trazer tudo e classificar" (pedido do usuário).
-- Oportunidades que a equipe ACHA fora do app (sites de emprego, classificado
-- de condomínio, grupo de moradores) e cadastra À MÃO pelo portal,
-- classificando:
--   tipo 'vaga'   → empresa contratando pintor. Vai pro app (tile "Vagas").
--   tipo 'pedido' → pessoa procurando pintor. NUNCA vai pro app: o telefone é
--                   de pessoa física que não pediu pra aparecer aqui. Fica só
--                   no portal, pra equipe responder.
--   status 'conferir' → acabou de entrar, ninguém confirmou que ainda vale.
--          'ativa'    → conferida; se for vaga, aparece no app.
--          'encerrada'→ saiu do ar.
-- Nada de robô: os sites de origem proíbem coleta automática.
-- RLS: admin faz tudo; usuário logado SÓ lê vaga ativa.
-- Uma instrução por linha (colar pelo celular corta bloco grande).

CREATE TABLE IF NOT EXISTS public.oportunidades (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz, tipo text NOT NULL CHECK (tipo IN ('vaga','pedido')), status text NOT NULL DEFAULT 'conferir' CHECK (status IN ('conferir','ativa','encerrada')), titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 3 AND 120), empresa text CHECK (char_length(empresa) <= 120), cidade text CHECK (char_length(cidade) <= 80), bairro text CHECK (char_length(bairro) <= 80), descricao text CHECK (char_length(descricao) <= 1500), remuneracao text CHECK (char_length(remuneracao) <= 80), contato text CHECK (char_length(contato) <= 40), contato_whatsapp boolean NOT NULL DEFAULT true, contato_obs text CHECK (char_length(contato_obs) <= 160), fonte text CHECK (char_length(fonte) <= 60), fonte_url text CHECK (fonte_url IS NULL OR (fonte_url ~* '^https://' AND char_length(fonte_url) <= 500)), anuncio_em date, created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL);

CREATE INDEX IF NOT EXISTS idx_oportunidades_vagas_ativas ON public.oportunidades (created_at DESC) WHERE tipo = 'vaga' AND status = 'ativa';

ALTER TABLE public.oportunidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oportunidades_admin_all ON public.oportunidades;
CREATE POLICY oportunidades_admin_all ON public.oportunidades FOR ALL TO authenticated USING ((SELECT public.is_portal_admin())) WITH CHECK ((SELECT public.is_portal_admin()));

DROP POLICY IF EXISTS oportunidades_vaga_ativa_select ON public.oportunidades;
CREATE POLICY oportunidades_vaga_ativa_select ON public.oportunidades FOR SELECT TO authenticated USING (tipo = 'vaga' AND status = 'ativa');

REVOKE ALL ON public.oportunidades FROM anon;

-- Conferência: as 3 linhas devem voltar ok = true.
SELECT 'tabela existe' AS item, to_regclass('public.oportunidades') IS NOT NULL AS ok
UNION ALL SELECT 'RLS ligada', coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.oportunidades')), false)
UNION ALL SELECT 'usuario comum so le vaga ativa', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oportunidades' AND policyname = 'oportunidades_vaga_ativa_select' AND qual LIKE '%vaga%' AND qual LIKE '%ativa%');
