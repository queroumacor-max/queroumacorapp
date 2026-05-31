-- Full-text search com tsvector + GIN
-- Cobre: posts.caption, products.name, profiles.name+bio
-- Linguagem: portuguese

BEGIN;

-- Posts
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(caption, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_posts_search
  ON public.posts USING GIN (search_vector);

-- Products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('portuguese', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('portuguese', coalesce(description, '')), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_products_search
  ON public.products USING GIN (search_vector);

-- Profiles (search público — usa profiles_public view)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('portuguese', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('portuguese', coalesce(bio, '')), 'B') ||
      setweight(to_tsvector('portuguese', coalesce(tag, '')), 'A')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_search
  ON public.profiles USING GIN (search_vector);

-- RPC pra search agregado
CREATE OR REPLACE FUNCTION public.search_all(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE(
  result_type text,
  id text,
  title text,
  snippet text,
  score real
) LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT plainto_tsquery('portuguese', p_query) AS tsq)
  SELECT 'profile' AS result_type, p.id::text, p.name AS title,
    ts_headline('portuguese', coalesce(p.bio,''), q.tsq) AS snippet,
    ts_rank(p.search_vector, q.tsq) AS score
  FROM public.profiles p, q
  WHERE p.search_vector @@ q.tsq
  UNION ALL
  SELECT 'post' AS result_type, po.id::text, left(coalesce(po.caption,''), 80) AS title,
    ts_headline('portuguese', coalesce(po.caption,''), q.tsq) AS snippet,
    ts_rank(po.search_vector, q.tsq) AS score
  FROM public.posts po, q
  WHERE po.search_vector @@ q.tsq
    AND po.status = 'approved'
  UNION ALL
  SELECT 'product' AS result_type, pr.id::text, pr.name AS title,
    ts_headline('portuguese', coalesce(pr.description,''), q.tsq) AS snippet,
    ts_rank(pr.search_vector, q.tsq) AS score
  FROM public.products pr, q
  WHERE pr.search_vector @@ q.tsq
  ORDER BY score DESC
  LIMIT p_limit;
$$;

COMMIT;
