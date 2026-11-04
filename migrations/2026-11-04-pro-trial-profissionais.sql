-- PRO GRÁTIS POR 30 DIAS PRA PROFISSIONAL NOVO (2026-11-04, decisão do
-- usuário: "1 profissionais / 2 novas / 3 se apagar e criar outra não").
--
-- Quem ganha: conta criada DEPOIS deste SQL rodar, no momento em que vira
-- profissional (pintor, grafiteiro, automotivo, arquiteto). Pega o cadastro
-- por e-mail (nasce com a categoria) e o Google/Apple (nasce cliente e
-- escolhe a categoria em /completar-perfil). Cliente que vira profissional
-- depois também ganha, se a conta for nova.
-- Uma vez por E-MAIL, pra sempre: `pro_trial_grants` guarda o hash do
-- e-mail e NÃO tem FK pra profiles — apagar a conta não apaga a marca.
-- Quem já é PRO não ganha (não encurta nem estende o que já tem).
-- Liga/desliga: UPDATE public.pro_trial_config SET ativo = false;
--
-- Idempotente. Uma instrução por bloco (o editor do celular corta bloco
-- grande).

-- 1. Configuração (linha única). `desde` = agora: contas antigas ficam de fora.
CREATE TABLE IF NOT EXISTS public.pro_trial_config (id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), ativo boolean NOT NULL DEFAULT true, dias int NOT NULL DEFAULT 30 CHECK (dias BETWEEN 1 AND 365), desde timestamptz NOT NULL DEFAULT now());

INSERT INTO public.pro_trial_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.pro_trial_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pro_trial_config_admin ON public.pro_trial_config;

CREATE POLICY pro_trial_config_admin ON public.pro_trial_config FOR ALL TO authenticated USING ((SELECT public.is_portal_admin())) WITH CHECK ((SELECT public.is_portal_admin()));

-- 2. Quem já ganhou. Sem FK de propósito: sobrevive à exclusão da conta.
CREATE TABLE IF NOT EXISTS public.pro_trial_grants (email_hash text PRIMARY KEY, user_id uuid, granted_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);

ALTER TABLE public.pro_trial_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pro_trial_grants_admin_read ON public.pro_trial_grants;

CREATE POLICY pro_trial_grants_admin_read ON public.pro_trial_grants FOR SELECT TO authenticated USING ((SELECT public.is_portal_admin()));

-- 3. A concessão. SECURITY DEFINER: o UPDATE de is_pro passa pela trava
-- protect_profile_columns como dono da função (confiável). Falha NUNCA
-- derruba o cadastro.
CREATE OR REPLACE FUNCTION public.grant_pro_trial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE c record; u record; v_hash text; v_ate timestamptz; v_ok uuid; BEGIN IF lower(coalesce(NEW.role, '')) NOT IN ('pintor', 'grafiteiro', 'automotivo', 'arquiteto') THEN RETURN NEW; END IF; IF NEW.is_pro = true AND (NEW.pro_expires_at IS NULL OR NEW.pro_expires_at > now()) THEN RETURN NEW; END IF; SELECT * INTO c FROM public.pro_trial_config WHERE id = 1; IF c IS NULL OR NOT c.ativo THEN RETURN NEW; END IF; SELECT email, created_at INTO u FROM auth.users WHERE id = NEW.id; IF u IS NULL OR u.created_at < c.desde THEN RETURN NEW; END IF; v_hash := md5(CASE WHEN nullif(trim(u.email), '') IS NOT NULL THEN 'email:' || lower(trim(u.email)) ELSE 'id:' || NEW.id::text END); v_ate := now() + make_interval(days => c.dias); INSERT INTO public.pro_trial_grants (email_hash, user_id, expires_at) VALUES (v_hash, NEW.id, v_ate) ON CONFLICT (email_hash) DO NOTHING RETURNING user_id INTO v_ok; IF v_ok IS NULL THEN RETURN NEW; END IF; UPDATE public.profiles SET is_pro = true, pro_expires_at = v_ate WHERE id = NEW.id; RETURN NEW; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'grant_pro_trial: %', SQLERRM; RETURN NEW; END $$;

REVOKE ALL ON FUNCTION public.grant_pro_trial() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_grant_pro_trial ON public.profiles;

CREATE TRIGGER trg_grant_pro_trial AFTER INSERT OR UPDATE OF role, user_type ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.grant_pro_trial();

-- Conferência: as 4 linhas têm que voltar ok = true.
SELECT 'config ligada' AS item, EXISTS (SELECT 1 FROM public.pro_trial_config WHERE id = 1 AND ativo) AS ok UNION ALL SELECT 'tabela de quem ganhou', to_regclass('public.pro_trial_grants') IS NOT NULL UNION ALL SELECT 'gatilho ligado', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_grant_pro_trial' AND NOT tgisinternal) UNION ALL SELECT 'anon sem EXECUTE', NOT has_function_privilege('anon', 'public.grant_pro_trial()', 'EXECUTE');
