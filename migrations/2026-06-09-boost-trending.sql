-- SQL Wave 22 (2026-06-09) — boost/pinned + trending explore (S11+S12)
-- ────────────────────────────────────────────────────────────────────
-- S11 boost: PRO destaca 1 post por vez por 7 dias. Coluna
-- `posts.boosted_until timestamptz` (NULL = sem boost). get_feed_v2
-- recriado pra inserir posts boosted no TOPO da primeira página (cursor
-- NULL). Em páginas seguintes, posts boosted aparecem normalmente por
-- created_at — não inflam infinitamente.
--
-- S12 trending: RPC `get_trending_posts(limit, window_days)` retorna
-- posts ordenados por score = likes_7d + 3*comments_7d. Página /explore
-- consome.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS boosted_until timestamptz;

-- Index parcial: só posts atualmente boosted entram. WHERE 7d gauge
-- vira válido enquanto NOW() < boosted_until.
CREATE INDEX IF NOT EXISTS idx_posts_boosted_active
  ON public.posts(boosted_until DESC) WHERE boosted_until > now();

-- RPC: boost de um post próprio. Valida ownership + PRO/portal. Atomic
-- swap: limpa boost ativo anterior do mesmo user antes de aplicar.
CREATE OR REPLACE FUNCTION public.boost_post(p_post_id uuid, p_days int DEFAULT 7)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_is_pro boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
    RAISE EXCEPTION 'Dias entre 1 e 30' USING ERRCODE = '22023';
  END IF;
  -- Ownership do post (admin não pode boost post alheio por aqui).
  IF NOT EXISTS (
    SELECT 1 FROM public.posts
    WHERE id = p_post_id AND user_id = v_user AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Post não encontrado ou não é seu' USING ERRCODE = '42501';
  END IF;
  -- Plan check: is_pro OU portal_access (admin/staff).
  SELECT (is_pro = true OR portal_access = true)
    INTO v_is_pro FROM public.profiles WHERE id = v_user;
  IF NOT COALESCE(v_is_pro, false) THEN
    RAISE EXCEPTION 'Recurso PRO' USING ERRCODE = '42501';
  END IF;
  -- Limpa boost ativo anterior (1 boost por user por vez).
  UPDATE public.posts SET boosted_until = NULL
   WHERE user_id = v_user AND boosted_until > now();
  -- Aplica novo boost.
  UPDATE public.posts
     SET boosted_until = now() + (p_days::text || ' days')::interval
   WHERE id = p_post_id;
END $$;
GRANT EXECUTE ON FUNCTION public.boost_post(uuid, int) TO authenticated;

-- RPC: remove boost (cancelar antes do prazo).
CREATE OR REPLACE FUNCTION public.unboost_post(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.posts SET boosted_until = NULL
   WHERE id = p_post_id AND user_id = auth.uid();
END $$;
GRANT EXECUTE ON FUNCTION public.unboost_post(uuid) TO authenticated;

-- Recria get_feed_v2 com priorização de boosted na PRIMEIRA página.
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
    -- Boosted entram no topo SÓ na 1ª página (cursor NULL). Limite 3 pra
    -- não monopolizar. Excluídos da regular abaixo.
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
      'role', pr.role, 'is_pro', pr.is_pro, 'city', pr.city, 'state', pr.state
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
    -- Mesma ORDER BY de filtered_posts pra preservar ordem após joins.
    CASE WHEN fp.boosted_until > now() THEN 1 ELSE 2 END,
    CASE WHEN fp.boosted_until > now() THEN fp.boosted_until END DESC NULLS LAST,
    fp.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) TO authenticated, anon;

-- S12: trending posts. Score = likes_window + 3*comments_window. Janela
-- default 7 dias. Considera só posts approved + active + não-story, e
-- exclui posts de bloqueados pelo user logado.
CREATE OR REPLACE FUNCTION public.get_trending_posts(
  p_limit int DEFAULT 30,
  p_window_days int DEFAULT 7
)
RETURNS TABLE (
  id            uuid,
  user_id       uuid,
  caption       text,
  media_url     text,
  media_type    text,
  media_width   int,
  media_height  int,
  created_at    timestamptz,
  score         int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  win AS (SELECT (now() - (p_window_days::text || ' days')::interval) AS since),
  likes_recent AS (
    SELECT post_id, count(*)::int AS n
    FROM public.likes, win
    WHERE created_at >= win.since
    GROUP BY post_id
  ),
  comments_recent AS (
    SELECT post_id, count(*)::int AS n
    FROM public.comments, win
    WHERE deleted_at IS NULL AND created_at >= win.since
    GROUP BY post_id
  )
  SELECT
    p.id, p.user_id, p.caption, p.media_url, p.media_type,
    p.media_width, p.media_height, p.created_at,
    (COALESCE(l.n, 0) + 3 * COALESCE(c.n, 0))::int AS score
  FROM public.posts p
  LEFT JOIN likes_recent l ON l.post_id = p.id
  LEFT JOIN comments_recent c ON c.post_id = p.id
  WHERE (p.status = 'approved' OR p.status IS NULL)
    AND p.deleted_at IS NULL
    AND COALESCE(p.media_type, '') <> 'story'
    AND (COALESCE(l.n, 0) + COALESCE(c.n, 0)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE b.blocker_id = auth.uid() AND b.blocked_id = p.user_id
    )
  ORDER BY score DESC, p.created_at DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_posts(int, int) TO authenticated, anon;
