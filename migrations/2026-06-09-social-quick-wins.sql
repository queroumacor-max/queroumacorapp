-- SQL Wave 20 (2026-06-09) — quick wins sociais (S1+S3+S4+S5)
-- ─────────────────────────────────────────────────────────────────
-- Adiciona colunas pras 4 features:
--   S1 Badge Verified  → profiles.verified (já existe na view, garante)
--   S3 Editar caption  → sem schema novo (UPDATE em posts.caption)
--   S4 Links externos  → profiles.instagram_url, website_url
--   S5 Story link      → posts.link_url
--
-- Tudo IF NOT EXISTS, idempotente. Também recria a view profiles_public
-- pra expor instagram_url + website_url (são públicos por design).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verified      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS website_url   text;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS link_url text;

-- Atualiza view pra incluir os campos novos. CREATE OR REPLACE não basta
-- quando muda colunas — drop+create.
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public WITH (security_invoker = true) AS
SELECT
  id, name, avatar_url, bio, tag, role, user_type, profession, specialties, palette,
  city, state, country, is_pro, verified, rating_avg, review_count,
  service_radius, instagram_url, website_url, created_at, portal_access
FROM public.profiles;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- Tem trigger protect_profile_columns BEFORE UPDATE que bloqueia o
-- próprio user mudar is_pro/portal_access/role=admin. `verified` segue
-- a mesma classe — deve ser admin-only. Garante via trigger update:

-- (revisa o trigger pra incluir verified se ainda não estiver)
-- A função protect_profile_columns já reverte INSERT com is_pro/role=admin/
-- portal_access escalados. Pra UPDATE, ele só protege quando o user
-- tenta mudar pra true. Mesma proteção pra verified:
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- INSERT: usuário comum não pode setar is_pro/portal/admin/verified como true.
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_pro = true OR NEW.portal_access = true OR NEW.role = 'admin' OR NEW.verified = true THEN
      IF NOT public.is_portal_admin() THEN
        NEW.is_pro := false;
        NEW.portal_access := false;
        NEW.verified := false;
        IF NEW.role = 'admin' THEN NEW.role := 'pintor'; END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: reverte mudança de flags privilegiadas se não-admin.
  IF TG_OP = 'UPDATE' THEN
    IF NOT public.is_portal_admin() THEN
      IF OLD.is_pro       IS DISTINCT FROM NEW.is_pro       THEN NEW.is_pro       := OLD.is_pro;       END IF;
      IF OLD.portal_access IS DISTINCT FROM NEW.portal_access THEN NEW.portal_access := OLD.portal_access; END IF;
      IF OLD.role         IS DISTINCT FROM NEW.role         THEN NEW.role         := OLD.role;         END IF;
      IF OLD.verified     IS DISTINCT FROM NEW.verified     THEN NEW.verified     := OLD.verified;     END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;
