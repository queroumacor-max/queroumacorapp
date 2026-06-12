-- BUG-02 (2026-06-12) — busca por palavra-chave (/search) só achava por nome
-- próprio. `profiles.search_vector` indexava apenas name + bio + tag, então
-- buscar "pintor", "grafiteiro", "textura" etc. não casava com pintores cujo
-- termo está em `profession`/`specialties` (e não na bio).
--
-- Fix: recria a coluna gerada incluindo `profession` (peso A) e `specialties`
-- (peso B). Ambas são `text` simples no schema (profession default 'pintor').
-- A RPC `search_all` continua igual — lê `p.search_vector`, que agora cobre
-- esses campos. Index GIN recriado.
--
-- Idempotente: DROP COLUMN IF EXISTS derruba a coluna + o índice dependente;
-- recriamos os dois.

ALTER TABLE public.profiles DROP COLUMN IF EXISTS search_vector;

ALTER TABLE public.profiles
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(tag, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(profession, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(specialties, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(bio, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_search
  ON public.profiles USING GIN (search_vector);
