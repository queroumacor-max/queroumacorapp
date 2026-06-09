-- SQL Wave 21 (2026-06-09) — bloqueio de usuário (S6)
-- ────────────────────────────────────────────────────────────────
-- Tabela `blocks(blocker_id, blocked_id)` com FK auth.users, UNIQUE
-- pra evitar duplicar, RLS owner-only (blocker só vê/insere/deleta os
-- seus). Helper RPC `list_blocked_ids()` devolve UUID[] do user logado
-- pra cliente filtrar feed/busca/etc sem N+1.

CREATE TABLE IF NOT EXISTS public.blocks (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON public.blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON public.blocks(blocked_id);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocks_select_own" ON public.blocks;
CREATE POLICY "blocks_select_own" ON public.blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "blocks_insert_own" ON public.blocks;
CREATE POLICY "blocks_insert_own" ON public.blocks FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "blocks_delete_own" ON public.blocks;
CREATE POLICY "blocks_delete_own" ON public.blocks FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

-- RPC helper: devolve array de blocked_id pro user logado. Cliente usa
-- pra filtrar feed/notificações em uma chamada (vs SELECT que retorna
-- linhas). Marca STABLE pra cache de plan.
CREATE OR REPLACE FUNCTION public.list_blocked_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(blocked_id), ARRAY[]::uuid[])
  FROM public.blocks
  WHERE blocker_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.list_blocked_ids() TO authenticated;

-- get_feed_v2 — atualizar pra também filtrar posts de blocked users.
-- Adiciona NOT EXISTS contra blocks (user logado bloqueou o autor).
-- DROP+CREATE pra preservar assinatura.
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
      -- S6: filtra posts de usuários que `p_user_id` bloqueou.
      AND (
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE b.blocker_id = p_user_id AND b.blocked_id = p.user_id
        )
      )
    ORDER BY p.created_at DESC
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
    fp.media_width, fp.media_height, fp.created_at,
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
  ORDER BY fp.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) TO authenticated, anon;

-- RPC pra sugestões de "quem seguir" (S2): top pintores que o user
-- não segue, ordenados por rating_avg DESC + review_count DESC.
-- Exclui também blocked + admin/portal. Mesmo cidade/UF rankeia primeiro
-- (mas não filtra — mostra todos pro user descobrir).
CREATE OR REPLACE FUNCTION public.suggest_to_follow(
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  id            uuid,
  name          text,
  tag           text,
  avatar_url    text,
  role          text,
  city          text,
  state         text,
  rating_avg    numeric,
  review_count  int,
  is_pro        boolean,
  verified      boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT id, city, state FROM public.profiles WHERE id = auth.uid()
  )
  SELECT
    p.id, p.name, p.tag, p.avatar_url, p.role,
    p.city, p.state, p.rating_avg, p.review_count, p.is_pro, p.verified
  FROM public.profiles p, me
  WHERE p.id <> auth.uid()
    AND COALESCE(p.role, '') <> 'admin'
    AND COALESCE(p.portal_access, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = auth.uid() AND f.following_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE b.blocker_id = auth.uid() AND b.blocked_id = p.id
    )
  ORDER BY
    -- Mesma cidade primeiro, depois mesma UF, depois resto.
    (p.city IS NOT DISTINCT FROM me.city) DESC,
    (p.state IS NOT DISTINCT FROM me.state) DESC,
    COALESCE(p.rating_avg, 0) DESC,
    COALESCE(p.review_count, 0) DESC,
    p.created_at DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.suggest_to_follow(int) TO authenticated;
