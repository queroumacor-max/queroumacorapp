-- 2026-10-31 — "escolhe pintor e fica como pintor"
--
-- O BURACO: quem entra por Google/Apple nasce com user_type='cliente' E
-- role='cliente' (handle_new_user usa 'cliente' como padrão quando o
-- provedor não manda categoria). No /completar-perfil a pessoa escolhe
-- Pintor: o app grava user_type='pintor', mas `role` FICA 'cliente', porque
--   (a) sync_role_from_user_type só preenchia role VAZIO; e
--   (b) protect_profile_columns (corrigida em 25/10) reverte qualquer
--       mudança de role feita pelo próprio usuário.
-- E o app quase todo lê `role` (tiles, selo, busca, feed): a pessoa
-- escolhia Pintor e o app a tratava como cliente.
--
-- A CORREÇÃO: role passa a SEGUIR user_type sempre que user_type muda.
-- Segurança: só os 5 papéis comuns viram role (nunca 'admin', que dá
-- is_portal_admin()), e role='admin' nunca é tocado. O trigger roda DEPOIS
-- do protect (ordem alfabética: trg_protect… < trg_sync…), então o que ele
-- escreve é a palavra final — por isso a lista fechada.

CREATE OR REPLACE FUNCTION public.sync_role_from_user_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v text;
BEGIN
  v := lower(nullif(trim(NEW.user_type), ''));
  IF v = 'funileiro' THEN v := 'automotivo'; END IF;
  IF v = 'engenheiro' THEN v := 'arquiteto'; END IF;
  IF v = 'graffiti' THEN v := 'grafiteiro'; END IF;
  IF v IN ('cliente','pintor','grafiteiro','automotivo','arquiteto')
     AND coalesce(NEW.role, '') <> 'admin'
     AND (TG_OP = 'INSERT'
          OR coalesce(NEW.role, '') = ''
          OR NEW.user_type IS DISTINCT FROM OLD.user_type) THEN
    NEW.role := v;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_role_from_user_type ON public.profiles;
CREATE TRIGGER trg_sync_role_from_user_type BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_role_from_user_type();

-- Backfill: quem já ficou dividido (user_type ≠ role). user_type é a fonte:
-- é o que a pessoa escolheu, e o portal (set_role) grava os dois juntos.
UPDATE public.profiles SET role = lower(user_type) WHERE lower(user_type) IN ('cliente','pintor','grafiteiro','automotivo','arquiteto') AND coalesce(role,'') <> 'admin' AND coalesce(role,'') <> lower(user_type);

-- Conferência: deve voltar 0.
SELECT count(*) AS divididos FROM public.profiles WHERE lower(user_type) IN ('cliente','pintor','grafiteiro','automotivo','arquiteto') AND coalesce(role,'') <> 'admin' AND coalesce(role,'') <> lower(user_type);
