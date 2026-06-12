-- SQL Wave 32 (2026-06-12) — R-H7: remover portal_access de profiles_public
--
-- A view atualmente expõe `portal_access` (boolean) o que vaza identidade
-- de admins pra qualquer caller authenticated. Atacante alveja exatamente
-- esses users em spear-phishing. Removido.
--
-- Mantém todas as outras colunas. Frontend que dependia de
-- profiles_public.portal_access precisa migrar pra consulta direta com RLS
-- admin-only (não há caller legítimo identificado no código atual).

drop view if exists public.profiles_public cascade;
create view public.profiles_public as
select
  id, name, avatar_url, bio, tag, role, user_type, profession, specialties,
  city, state, is_pro, verified, rating_avg, review_count,
  service_radius, instagram_url, website_url, created_at
  -- portal_access removido (Wave 32 — R-H7)
  -- palette/country removidos: não existem na tabela real (ver CLAUDE.md)
from public.profiles;

-- Garante leitura pública na view (RLS na tabela base segue valendo
-- normalmente — a view só lê o subconjunto de colunas seguro).
grant select on public.profiles_public to anon, authenticated;
