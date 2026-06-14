-- 2026-06-14 — profiles_public expõe os contadores desnormalizados
-- (followers_count, following_count, posts_count) pra o perfil público
-- (/perfil/[id]) ler direto, sem COUNT(*) manual.
--
-- As colunas já existem em `profiles` (mantidas por triggers). Aqui só
-- recriamos a view pra projetá-las. Mantém o restante idêntico à Wave 32
-- (SEM portal_access — R-H7; SEM palette/country, que não existem na tabela).

drop view if exists public.profiles_public cascade;
create view public.profiles_public as
select
  id, name, avatar_url, bio, tag, role, user_type, profession, specialties,
  city, state, is_pro, verified, rating_avg, review_count,
  service_radius, instagram_url, website_url,
  followers_count, following_count, posts_count,
  created_at
from public.profiles;

grant select on public.profiles_public to anon, authenticated;
