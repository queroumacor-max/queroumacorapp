-- 2026-11-10 — leitura automática dos murais de classificados de condomínio
-- (pedido do usuário; ele informou que a plataforma AUTORIZOU a leitura).
--
-- `oportunidade_fontes` = quais murais ler (cadastrados pelo portal). Uma vez
-- por dia o cron chama POST /api/oportunidades/varrer, que baixa cada mural,
-- separa os anúncios em que alguém PROCURA pintor e grava em `oportunidades`
-- como tipo='pedido', status='conferir' — só o portal vê (RLS de 10/11-b).
-- `oportunidades.chave` (hash de fonte + texto) impede o mesmo anúncio de
-- entrar duas vezes.
-- O cron reusa o segredo interno do push (`app_settings.push_internal_secret`
-- / env PUSH_INTERNAL_SECRET), igual ao `run_posts_sweep`: nada pra colar.
-- Rodar DEPOIS de 2026-11-10-b-oportunidades.sql. Uma instrução por bloco.

CREATE TABLE IF NOT EXISTS public.oportunidade_fontes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), nome text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 120), url text NOT NULL UNIQUE CHECK (url ~* '^https://' AND char_length(url) <= 300), cidade text CHECK (char_length(cidade) <= 80), bairro text CHECK (char_length(bairro) <= 80), ativo boolean NOT NULL DEFAULT true, lida_em timestamptz, resultado text CHECK (char_length(resultado) <= 300));

ALTER TABLE public.oportunidade_fontes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oportunidade_fontes_admin_all ON public.oportunidade_fontes;
CREATE POLICY oportunidade_fontes_admin_all ON public.oportunidade_fontes FOR ALL TO authenticated USING ((SELECT public.is_portal_admin())) WITH CHECK ((SELECT public.is_portal_admin()));

REVOKE ALL ON public.oportunidade_fontes FROM anon;

ALTER TABLE public.oportunidades ADD COLUMN IF NOT EXISTS chave text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_oportunidades_chave ON public.oportunidades (chave);

INSERT INTO public.oportunidade_fontes (nome, url, cidade, bairro) VALUES ('Parque Santa Clara', 'https://parquesantaclara.com.br/classificados', 'Guarulhos', 'Vila Alzira'), ('Costa do Sol', 'https://costadosolbutanta.com.br/classificados', 'São Paulo', 'Jardim das Vertentes'), ('Vivaz Prime', 'https://vivazprimecachoeirinha.com.br/classificados', 'São Paulo', 'Limão'), ('Condomínio França', 'https://condominiofrancasp.com.br/classificados', 'São Paulo', 'Vila Guilherme') ON CONFLICT (url) DO NOTHING;

CREATE OR REPLACE FUNCTION public.run_oportunidades_varredura() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$ DECLARE v_push text; v_secret text; BEGIN SELECT value INTO v_push FROM public.app_settings WHERE key = 'push_notify_url'; SELECT value INTO v_secret FROM public.app_settings WHERE key = 'push_internal_secret'; IF coalesce(v_push, '') = '' OR coalesce(v_secret, '') = '' THEN RETURN; END IF; PERFORM net.http_post(url := replace(v_push, '/api/push-notify', '/api/oportunidades/varrer'), headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret), body := '{}'::jsonb); END; $$;

REVOKE ALL ON FUNCTION public.run_oportunidades_varredura() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_oportunidades_varredura() TO service_role;

-- Todo dia às 08:17 de Brasília (11:17 UTC).
SELECT cron.schedule('oportunidades-varredura', '17 11 * * *', $$SELECT public.run_oportunidades_varredura();$$);

-- Conferência: as 4 linhas devem voltar ok = true.
SELECT 'fontes cadastradas' AS item, (SELECT count(*) FROM public.oportunidade_fontes) >= 4 AS ok
UNION ALL SELECT 'coluna chave unica', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_oportunidades_chave')
UNION ALL SELECT 'funcao da varredura', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'run_oportunidades_varredura')
UNION ALL SELECT 'cron agendado', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oportunidades-varredura');
