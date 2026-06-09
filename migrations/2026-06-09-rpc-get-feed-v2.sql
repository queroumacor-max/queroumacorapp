-- SQL Wave 16 (2026-06-09) — RPC get_feed_v2 (feed em 1 round-trip)
-- ────────────────────────────────────────────────────────────────────
-- Substitui o trio Wave A (posts) + Wave B (profiles 2x + likes + comments
-- + saved) em next-app/lib/services/feed.ts:127-338 por UMA chamada.
--
-- Latência esperada: 5 round-trips paralelos → 1 round-trip. Em mobile
-- 4G (~100ms/round-trip) representa ~400ms a menos.
--
-- ATENÇÃO: este SQL CRIA a função no banco mas NÃO troca o caller no
-- frontend. O swap em fetchFeed() precisa ser feito numa segunda etapa
-- (review próprio porque feed é o caminho crítico do app). A função
-- pode existir ociosa sem efeito colateral.
--
-- Shape do retorno: jsonb agregado por post — compatível com o que o
-- frontend precisa pra montar EnrichedPost (id, user_id, media_url,
-- media_type, caption, created_at, author{id,name,tag,avatar_url},
-- like_count, liked_by_me, saved_by_me, comments[]).

CREATE OR REPLACE FUNCTION public.get_feed_v2(
  p_limit       int          DEFAULT 10,
  p_cursor      timestamptz  DEFAULT NULL,
  p_user_id     uuid         DEFAULT NULL,
  p_following_ids uuid[]     DEFAULT NULL,
  p_role_filter text         DEFAULT NULL
)
RETURNS TABLE (
  post_id          uuid,
  user_id          uuid,
  caption          text,
  media_url        text,
  media_type       text,
  created_at       timestamptz,
  author           jsonb,
  like_count       bigint,
  comment_count    bigint,
  liked_by_me      boolean,
  saved_by_me      boolean,
  top_comments     jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  filtered_posts AS (
    SELECT p.*
    FROM public.posts p
    WHERE
      (p.status = 'approved' OR p.status IS NULL)
      AND p.deleted_at IS NULL
      AND COALESCE(p.media_type, '') <> 'story'
      AND (p_cursor IS NULL OR p.created_at < p_cursor)
      AND (p_following_ids IS NULL OR p.user_id = ANY(p_following_ids))
      AND (
        p_role_filter IS NULL
        OR EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.user_id AND pr.role = p_role_filter
        )
      )
    ORDER BY p.created_at DESC
    LIMIT p_limit
  ),
  authors AS (
    SELECT pr.id, jsonb_build_object(
      'id', pr.id,
      'name', pr.name,
      'tag', pr.tag,
      'avatar_url', pr.avatar_url,
      'role', pr.role,
      'is_pro', pr.is_pro,
      'city', pr.city,
      'state', pr.state
    ) AS author_json
    FROM public.profiles pr
    WHERE pr.id IN (SELECT user_id FROM filtered_posts)
  ),
  like_counts AS (
    SELECT post_id, count(*)::bigint AS n
    FROM public.likes
    WHERE post_id IN (SELECT id FROM filtered_posts)
    GROUP BY post_id
  ),
  my_likes AS (
    SELECT post_id
    FROM public.likes
    WHERE p_user_id IS NOT NULL
      AND user_id = p_user_id
      AND post_id IN (SELECT id FROM filtered_posts)
  ),
  my_saved AS (
    SELECT post_id
    FROM public.saved_posts
    WHERE p_user_id IS NOT NULL
      AND user_id = p_user_id
      AND post_id IN (SELECT id FROM filtered_posts)
  ),
  comment_counts AS (
    SELECT post_id, count(*)::bigint AS n
    FROM public.comments
    WHERE deleted_at IS NULL
      AND post_id IN (SELECT id FROM filtered_posts)
    GROUP BY post_id
  ),
  -- Top 3 comments mais recentes por post, com autor inline.
  ranked_comments AS (
    SELECT
      c.id, c.post_id, c.user_id, c.text, c.created_at,
      row_number() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC) AS rn
    FROM public.comments c
    WHERE c.deleted_at IS NULL
      AND c.post_id IN (SELECT id FROM filtered_posts)
  ),
  top_comments_per_post AS (
    SELECT
      rc.post_id,
      jsonb_agg(
        jsonb_build_object(
          'id', rc.id,
          'user_id', rc.user_id,
          'text', rc.text,
          'created_at', rc.created_at,
          'author', (
            SELECT jsonb_build_object('id', pr.id, 'name', pr.name, 'tag', pr.tag, 'avatar_url', pr.avatar_url)
            FROM public.profiles pr WHERE pr.id = rc.user_id
          )
        )
        ORDER BY rc.created_at ASC
      ) FILTER (WHERE rc.rn <= 3) AS comments_json
    FROM ranked_comments rc
    GROUP BY rc.post_id
  )
  SELECT
    fp.id                                                       AS post_id,
    fp.user_id                                                  AS user_id,
    fp.caption                                                  AS caption,
    fp.media_url                                                AS media_url,
    fp.media_type                                               AS media_type,
    fp.created_at                                               AS created_at,
    COALESCE(a.author_json, '{}'::jsonb)                        AS author,
    COALESCE(lc.n, 0)                                           AS like_count,
    COALESCE(cc.n, 0)                                           AS comment_count,
    (ml.post_id IS NOT NULL)                                    AS liked_by_me,
    (ms.post_id IS NOT NULL)                                    AS saved_by_me,
    COALESCE(tcp.comments_json, '[]'::jsonb)                    AS top_comments
  FROM filtered_posts fp
  LEFT JOIN authors a ON a.id = fp.user_id
  LEFT JOIN like_counts lc ON lc.post_id = fp.id
  LEFT JOIN my_likes ml ON ml.post_id = fp.id
  LEFT JOIN my_saved ms ON ms.post_id = fp.id
  LEFT JOIN comment_counts cc ON cc.post_id = fp.id
  LEFT JOIN top_comments_per_post tcp ON tcp.post_id = fp.id
  ORDER BY fp.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) TO authenticated, anon;
