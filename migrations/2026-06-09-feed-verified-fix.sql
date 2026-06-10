-- SQL Wave 23 (2026-06-09) — bug fix B1 (badge verified no feed)
-- ────────────────────────────────────────────────────────────────
-- get_feed_v2 (Wave 22) não exportava `verified` no JSON do author,
-- então o badge ✓ S1 (Wave 20) só renderizava no fallback legacy. Em
-- prod (RPC v2), users `verified=true && is_pro=false` ficavam sem badge.
--
-- Fix: DROP+CREATE adicionando `verified` no jsonb_build_object. Mantém
-- toda a lógica de boosted_until + blocks idêntica à Wave 22.

DROP FUNCTION IF EXISTS public.get_feed_v2(int, timestamptz, uuid, uuid[], text);

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
  media_width      int,
  media_height     int,
  created_at       timestamptz,
  boosted_until    timestamptz,
  author           jsonb,
  like_count       bigint,
  comment_count    bigint,
  liked_by_me      boolean,
  saved_by_me      boolean,
  top_comments     jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  base_filter AS (
    SELECT p.*
    FROM public.posts p
    WHERE
      (p.status = 'approved' OR p.status IS NULL)
      AND p.deleted_at IS NULL
      AND COALESCE(p.media_type, '') <> 'story'
      AND (p_following_ids IS NULL OR p.user_id = ANY(p_following_ids))
      AND (
        p_role_filter IS NULL
        OR EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.user_id AND pr.role = p_role_filter
        )
      )
      AND (
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE b.blocker_id = p_user_id AND b.blocked_id = p.user_id
        )
      )
  ),
  boosted_top AS (
    SELECT *, 1 AS sort_group FROM base_filter
    WHERE p_cursor IS NULL AND boosted_until > now()
    ORDER BY boosted_until DESC
    LIMIT 3
  ),
  regular AS (
    SELECT *, 2 AS sort_group FROM base_filter
    WHERE (p_cursor IS NULL OR created_at < p_cursor)
      AND id NOT IN (SELECT id FROM boosted_top)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  combined AS (
    SELECT * FROM boosted_top
    UNION ALL
    SELECT * FROM regular
  ),
  filtered_posts AS (
    SELECT * FROM combined
    ORDER BY sort_group ASC,
             CASE sort_group WHEN 1 THEN boosted_until END DESC NULLS LAST,
             created_at DESC
    LIMIT p_limit
  ),
  authors AS (
    SELECT pr.id, jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'tag', pr.tag, 'avatar_url', pr.avatar_url,
      'role', pr.role, 'is_pro', pr.is_pro,
      -- Wave 23 fix B1: include verified (Wave 20 / S1) pra badge ✓ no feed.
      'verified', pr.verified,
      'city', pr.city, 'state', pr.state
    ) AS author_json
    FROM public.profiles pr
    WHERE pr.id IN (SELECT user_id FROM filtered_posts)
  ),
  like_counts AS (
    SELECT post_id, count(*)::bigint AS n FROM public.likes
    WHERE post_id IN (SELECT id FROM filtered_posts) GROUP BY post_id
  ),
  my_likes AS (
    SELECT post_id FROM public.likes
    WHERE p_user_id IS NOT NULL AND user_id = p_user_id
      AND post_id IN (SELECT id FROM filtered_posts)
  ),
  my_saved AS (
    SELECT post_id FROM public.saved_posts
    WHERE p_user_id IS NOT NULL AND user_id = p_user_id
      AND post_id IN (SELECT id FROM filtered_posts)
  ),
  comment_counts AS (
    SELECT post_id, count(*)::bigint AS n FROM public.comments
    WHERE deleted_at IS NULL AND post_id IN (SELECT id FROM filtered_posts)
    GROUP BY post_id
  ),
  ranked_comments AS (
    SELECT
      c.id, c.post_id, c.user_id, c.text, c.created_at,
      row_number() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC) AS rn
    FROM public.comments c
    WHERE c.deleted_at IS NULL AND c.post_id IN (SELECT id FROM filtered_posts)
  ),
  top_comments_per_post AS (
    SELECT
      rc.post_id,
      jsonb_agg(
        jsonb_build_object(
          'id', rc.id, 'user_id', rc.user_id, 'text', rc.text,
          'created_at', rc.created_at,
          'author', (
            SELECT jsonb_build_object('id', pr.id, 'name', pr.name, 'tag', pr.tag, 'avatar_url', pr.avatar_url)
            FROM public.profiles pr WHERE pr.id = rc.user_id
          )
        )
        ORDER BY rc.created_at ASC
      ) FILTER (WHERE rc.rn <= 3) AS comments_json
    FROM ranked_comments rc GROUP BY rc.post_id
  )
  SELECT
    fp.id, fp.user_id, fp.caption, fp.media_url, fp.media_type,
    fp.media_width, fp.media_height, fp.created_at, fp.boosted_until,
    COALESCE(a.author_json, '{}'::jsonb),
    COALESCE(lc.n, 0), COALESCE(cc.n, 0),
    (ml.post_id IS NOT NULL), (ms.post_id IS NOT NULL),
    COALESCE(tcp.comments_json, '[]'::jsonb)
  FROM filtered_posts fp
  LEFT JOIN authors a ON a.id = fp.user_id
  LEFT JOIN like_counts lc ON lc.post_id = fp.id
  LEFT JOIN my_likes ml ON ml.post_id = fp.id
  LEFT JOIN my_saved ms ON ms.post_id = fp.id
  LEFT JOIN comment_counts cc ON cc.post_id = fp.id
  LEFT JOIN top_comments_per_post tcp ON tcp.post_id = fp.id
  ORDER BY
    CASE WHEN fp.boosted_until > now() THEN 1 ELSE 2 END,
    CASE WHEN fp.boosted_until > now() THEN fp.boosted_until END DESC NULLS LAST,
    fp.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) TO authenticated, anon;
