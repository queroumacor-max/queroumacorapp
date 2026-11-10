-- 2026-11-10 — "Precisa de pintor?" (pedido do usuário: trazer clientes
-- procurando pintor). Página PÚBLICA /pedir grava aqui; a equipe vê no
-- portal ("Pedidos de pintor") e encaminha a um pintor à mão.
--
-- Segurança:
--   - RLS ON. SELECT/UPDATE/DELETE só is_portal_admin() (embrulhado em
--     (select …) — regra de 13/09: função em policy sempre em InitPlan).
--   - SEM policy de INSERT: quem grava é a rota /api/pedidos-pintor com
--     service_role (valida, limita por IP). anon/authenticated não inserem
--     direto pelo REST.
--   - Nome e telefone são dado pessoal: `consent_at` guarda a hora em que a
--     pessoa marcou "aceito que meu contato seja passado a pintores
--     parceiros para este orçamento".
-- Uma instrução por linha (colar pelo celular corta bloco grande).

CREATE TABLE IF NOT EXISTS public.pedidos_pintor (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), servico text NOT NULL CHECK (char_length(servico) <= 60), descricao text NOT NULL CHECK (char_length(descricao) <= 1500), cidade text NOT NULL CHECK (char_length(cidade) <= 80), bairro text CHECK (char_length(bairro) <= 80), prazo text CHECK (char_length(prazo) <= 40), nome text NOT NULL CHECK (char_length(nome) <= 80), telefone text NOT NULL CHECK (char_length(telefone) <= 20), consent_at timestamptz NOT NULL DEFAULT now(), origem text CHECK (char_length(origem) <= 40), status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','encaminhado','fechado','descartado')), encaminhado_para text CHECK (char_length(encaminhado_para) <= 120), observacao text CHECK (char_length(observacao) <= 1000), updated_at timestamptz);

CREATE INDEX IF NOT EXISTS idx_pedidos_pintor_created ON public.pedidos_pintor (created_at DESC);

ALTER TABLE public.pedidos_pintor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pedidos_pintor_admin_select ON public.pedidos_pintor;
CREATE POLICY pedidos_pintor_admin_select ON public.pedidos_pintor FOR SELECT TO authenticated USING ((SELECT public.is_portal_admin()));

DROP POLICY IF EXISTS pedidos_pintor_admin_update ON public.pedidos_pintor;
CREATE POLICY pedidos_pintor_admin_update ON public.pedidos_pintor FOR UPDATE TO authenticated USING ((SELECT public.is_portal_admin())) WITH CHECK ((SELECT public.is_portal_admin()));

DROP POLICY IF EXISTS pedidos_pintor_admin_delete ON public.pedidos_pintor;
CREATE POLICY pedidos_pintor_admin_delete ON public.pedidos_pintor FOR DELETE TO authenticated USING ((SELECT public.is_portal_admin()));

REVOKE ALL ON public.pedidos_pintor FROM anon;

-- Conferência: as 3 linhas devem voltar ok = true.
SELECT 'tabela existe' AS item, to_regclass('public.pedidos_pintor') IS NOT NULL AS ok
UNION ALL SELECT 'RLS ligada', coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.pedidos_pintor')), false)
UNION ALL SELECT 'sem policy de INSERT', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pedidos_pintor' AND cmd IN ('INSERT','ALL'));
