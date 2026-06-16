-- SQL Wave 34 (2026-06-16) — respostas em comentários + curtida de comentário
-- ──────────────────────────────────────────────────────────────────────────
-- Feature dos prints (2026-06-16): "responder o comentário que a pessoa fez
-- no meu post" + "pôr o pincel de curtir no comentário dele".
--
--   1. comments.parent_id  → resposta a outro comentário (1 nível, estilo IG).
--   2. comment_likes        → curtida (pincel) por comentário, espelha `likes`.
--   3. triggers de notificação: curtir comentário avisa o dono do comentário;
--      responder avisa também o dono do comentário pai.
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).

-- ─── 1. parent_id (resposta) ────────────────────────────────────────────────
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id uuid
    REFERENCES public.comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_comments_parent_active
  ON public.comments(parent_id, created_at)
  WHERE deleted_at IS NULL;

-- ─── 2. comment_likes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comment_likes (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment
  ON public.comment_likes(comment_id);

ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

-- SELECT só pra authenticated (espelha a policy de `likes`, Wave 3). Visitante
-- vê contagem 0 — o feed (get_feed_v2, SECURITY DEFINER) já cobre o preview.
DROP POLICY IF EXISTS "comment_likes select" ON public.comment_likes;
CREATE POLICY "comment_likes select" ON public.comment_likes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "comment_likes insert own" ON public.comment_likes;
CREATE POLICY "comment_likes insert own" ON public.comment_likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "comment_likes delete own" ON public.comment_likes;
CREATE POLICY "comment_likes delete own" ON public.comment_likes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ─── 3a. notificação ao curtir comentário ───────────────────────────────────
-- Avisa o dono do comentário (exceto self-like). ref_id = post pra o clique
-- na notificação levar ao post (NotificationsList.destFor).
CREATE OR REPLACE FUNCTION public.notify_on_comment_like()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_post uuid;
  v_actor_label text;
BEGIN
  SELECT user_id, post_id INTO v_owner, v_post
  FROM public.comments WHERE id = NEW.comment_id;
  IF v_owner IS NULL OR v_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;
  v_actor_label := public.notif_actor_label(NEW.user_id);
  INSERT INTO public.notifications
    (user_id, actor_id, type, title, body, ref_id, created_at)
  VALUES
    (v_owner, NEW.user_id, 'like',
     'Nova curtida',
     v_actor_label || ' curtiu seu comentário',
     v_post, now());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_comment_like ON public.comment_likes;
CREATE TRIGGER trg_notify_on_comment_like
  AFTER INSERT ON public.comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment_like();

-- ─── 3b. notificação de resposta ────────────────────────────────────────────
-- Recria notify_on_comment (Wave 14) pra, além de avisar o dono do post,
-- avisar o dono do comentário pai quando o novo comment é uma resposta.
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post_owner uuid;
  v_parent_owner uuid;
  v_actor_label text;
  v_preview text;
BEGIN
  SELECT user_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
  v_actor_label := public.notif_actor_label(NEW.user_id);
  v_preview := CASE
    WHEN length(NEW.text) > 80 THEN substring(NEW.text from 1 for 80) || '…'
    ELSE NEW.text
  END;

  -- Dono do post (exceto self).
  IF v_post_owner IS NOT NULL AND v_post_owner <> NEW.user_id THEN
    INSERT INTO public.notifications
      (user_id, actor_id, type, title, body, ref_id, created_at)
    VALUES
      (v_post_owner, NEW.user_id, 'comment',
       'Novo comentário',
       v_actor_label || ': ' || v_preview,
       NEW.post_id, now());
  END IF;

  -- Resposta: avisa o dono do comentário pai (se for outra pessoa e não for
  -- o dono do post — pra não duplicar a notificação).
  IF NEW.parent_id IS NOT NULL THEN
    SELECT user_id INTO v_parent_owner FROM public.comments WHERE id = NEW.parent_id;
    IF v_parent_owner IS NOT NULL
       AND v_parent_owner <> NEW.user_id
       AND v_parent_owner IS DISTINCT FROM v_post_owner THEN
      INSERT INTO public.notifications
        (user_id, actor_id, type, title, body, ref_id, created_at)
      VALUES
        (v_parent_owner, NEW.user_id, 'comment',
         'Nova resposta',
         v_actor_label || ' respondeu: ' || v_preview,
         NEW.post_id, now());
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Trigger trg_notify_on_comment (Wave 13) já aponta pra esta função; o
-- CREATE OR REPLACE acima é suficiente.
