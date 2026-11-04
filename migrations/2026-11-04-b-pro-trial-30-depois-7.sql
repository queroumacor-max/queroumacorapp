-- PRO GRÁTIS: 30 DIAS ATÉ 31/12, 7 DIAS A PARTIR DE JANEIRO (2026-11-04,
-- decisão do usuário: "Todos que se cadastrarem até 31/12 receberão grátis 30
-- dias premium a contar da data de cadastro... A partir de janeiro, 7 dias
-- grátis para teste a partir da data que cadastra").
--
-- Complementa 2026-11-04-pro-trial-profissionais.sql (que precisa ter rodado).
-- O que muda:
--   * o período é decidido pela DATA DE CADASTRO (auth.users.created_at):
--     antes de 01/01/2027 00:00 de Brasília = 30 dias; depois = 7 dias;
--   * o prazo conta DA DATA DE CADASTRO, não do momento em que a pessoa
--     escolheu a categoria (quem entrou como cliente e virou pintor 10 dias
--     depois ganha só o que sobra; se já passou, não ganha nada).
-- Continua: só profissionais, só conta nova, 1 vez por e-mail.
-- Idempotente. Uma instrução por bloco.

ALTER TABLE public.pro_trial_config ADD COLUMN IF NOT EXISTS troca_em timestamptz NOT NULL DEFAULT '2027-01-01 00:00:00-03';

ALTER TABLE public.pro_trial_config ADD COLUMN IF NOT EXISTS dias_depois int NOT NULL DEFAULT 7 CHECK (dias_depois BETWEEN 1 AND 365);

CREATE OR REPLACE FUNCTION public.grant_pro_trial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE c record; u record; v_hash text; v_dias int; v_ate timestamptz; v_ok uuid; BEGIN IF lower(coalesce(NEW.role, '')) NOT IN ('pintor', 'grafiteiro', 'automotivo', 'arquiteto') THEN RETURN NEW; END IF; IF NEW.is_pro = true AND (NEW.pro_expires_at IS NULL OR NEW.pro_expires_at > now()) THEN RETURN NEW; END IF; SELECT * INTO c FROM public.pro_trial_config WHERE id = 1; IF c IS NULL OR NOT c.ativo THEN RETURN NEW; END IF; SELECT email, created_at INTO u FROM auth.users WHERE id = NEW.id; IF u IS NULL OR u.created_at < c.desde THEN RETURN NEW; END IF; v_dias := CASE WHEN u.created_at < c.troca_em THEN c.dias ELSE c.dias_depois END; v_ate := u.created_at + make_interval(days => v_dias); IF v_ate <= now() THEN RETURN NEW; END IF; v_hash := md5(CASE WHEN nullif(trim(u.email), '') IS NOT NULL THEN 'email:' || lower(trim(u.email)) ELSE 'id:' || NEW.id::text END); INSERT INTO public.pro_trial_grants (email_hash, user_id, expires_at) VALUES (v_hash, NEW.id, v_ate) ON CONFLICT (email_hash) DO NOTHING RETURNING user_id INTO v_ok; IF v_ok IS NULL THEN RETURN NEW; END IF; UPDATE public.profiles SET is_pro = true, pro_expires_at = v_ate WHERE id = NEW.id; RETURN NEW; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'grant_pro_trial: %', SQLERRM; RETURN NEW; END $$;

REVOKE ALL ON FUNCTION public.grant_pro_trial() FROM PUBLIC, anon, authenticated;

-- Conferência: as 3 linhas têm que voltar ok = true.
SELECT 'troca pra 7 dias em 01/01/2027' AS item, EXISTS (SELECT 1 FROM public.pro_trial_config WHERE id = 1 AND troca_em = '2027-01-01 00:00:00-03' AND dias = 30 AND dias_depois = 7) AS ok UNION ALL SELECT 'função conta da data de cadastro', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'grant_pro_trial' AND prosrc LIKE '%u.created_at + make_interval%') UNION ALL SELECT 'gatilho ligado', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_grant_pro_trial' AND NOT tgisinternal);
