-- BUG-04 (2026-06-12) — filtros de categoria no feed (Pintura/Grafite/
-- Automotivo) voltavam vazios. Causa raiz: o signup grava a categoria
-- profissional em `profiles.user_type` (via metadata do auth +
-- handle_new_user), mas a RPC `get_feed_v2` filtra por `profiles.role`
-- (`pr.role = p_role_filter`). Como `role` ficava NULL pra quem se cadastrou
-- pelo fluxo novo, o filtro nunca casava → feed vazio. O mesmo descasamento
-- afetava o fallback client-side e os badges de role no app.
--
-- Fix em duas partes:
--   1) Backfill: copia user_type -> role onde role está vazio.
--   2) Trigger BEFORE INSERT/UPDATE pra manter sincronizado daqui pra frente.
--
-- Segurança: só preenche quando role está vazio — NUNCA sobrescreve um
-- role já setado (ex.: 'admin'), então não conflita com
-- protect_profile_columns (que roda antes, em ordem alfabética, e nesse
-- ponto NEW.role ainda está NULL → sem escalada a barrar).

UPDATE public.profiles
   SET role = user_type
 WHERE (role IS NULL OR role = '')
   AND user_type IS NOT NULL
   AND user_type <> '';

CREATE OR REPLACE FUNCTION public.sync_role_from_user_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.role IS NULL OR NEW.role = '')
     AND NEW.user_type IS NOT NULL AND NEW.user_type <> '' THEN
    NEW.role := NEW.user_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_role_from_user_type ON public.profiles;
CREATE TRIGGER trg_sync_role_from_user_type
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_from_user_type();
