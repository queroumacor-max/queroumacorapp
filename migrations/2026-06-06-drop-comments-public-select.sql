-- SQL Wave 11 (2026-06-06) — limpar policy aberta de SELECT em comments
-- ──────────────────────────────────────────────────────────────────────────
-- Motivação: "Comments are viewable by everyone" (USING true) foi criada
-- no init e nunca dropada. Wave 3 adicionou "comments_select_auth" (TO
-- authenticated) e Wave 8 adicionou "View comments active" (com filtro
-- de deleted_at), mas como RLS é OR'd em policies permissivas, a antiga
-- com USING(true) anula as restrições — anônimos liam tudo, inclusive
-- comments soft-deletados.
--
-- Na prática a UI não tem caminho anônimo pra ler comments, então não
-- era exploitable — mas a intenção das policies novas era restringir e
-- a antiga estava silenciosamente vencendo todas. Dropar deixa as 2
-- restritivas valerem (qualquer auth lê ativos, admin/owner lê tudo).

DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
