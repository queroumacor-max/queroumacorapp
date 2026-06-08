-- SQL Wave 13 (2026-06-08) — notificações automáticas em like/comment
-- ──────────────────────────────────────────────────────────────────────
-- Motivação: o sino (`bell icon`) tem unread count + realtime no
-- frontend, mas hoje só `notify_user()` RPC insere rows em
-- `public.notifications` — e a RPC exige relação prévia (quote ou
-- conversa) entre actor e destinatário. Resultado: curtir/comentar post
-- de outro usuário NÃO gera notificação, contrariando a expectativa do
-- usuário ("aparece um numerinho no sino").
--
-- Solução: triggers `AFTER INSERT` em `likes` e `comments` que inserem
-- diretamente em `notifications` via SECURITY DEFINER (bypass de RLS),
-- com guard pra não notificar self-actions (curtir próprio post).
--
-- Não modifica RLS de `notifications` — só o trigger insere; clients
-- continuam só lendo/marcando-como-lida.

-- ─── Helper: pega tag/name do actor pra mensagem amigável ─────────────
CREATE OR REPLACE FUNCTION public.notif_actor_label(p_actor_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF('@' || NULLIF(p.tag, ''), '@'),
    NULLIF(p.name, ''),
    'Alguém'
  )
  FROM public.profiles p
  WHERE p.id = p_actor_id;
$$;

-- ─── Trigger: like → notification ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post_owner uuid;
  v_actor_label text;
BEGIN
  SELECT user_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
  -- Self-like: não notifica.
  IF v_post_owner IS NULL OR v_post_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;
  v_actor_label := public.notif_actor_label(NEW.user_id);
  INSERT INTO public.notifications
    (user_id, actor_id, type, title, body, ref_id, created_at)
  VALUES
    (v_post_owner, NEW.user_id, 'like',
     'Nova curtida',
     v_actor_label || ' curtiu seu post',
     NEW.post_id::text, now());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_like ON public.likes;
CREATE TRIGGER trg_notify_on_like
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_like();

-- ─── Trigger: comment → notification ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post_owner uuid;
  v_actor_label text;
  v_preview text;
BEGIN
  SELECT user_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
  IF v_post_owner IS NULL OR v_post_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;
  v_actor_label := public.notif_actor_label(NEW.user_id);
  -- Preview de 80 chars do texto pra não estourar a UI da notif.
  v_preview := CASE
    WHEN length(NEW.text) > 80 THEN substring(NEW.text from 1 for 80) || '…'
    ELSE NEW.text
  END;
  INSERT INTO public.notifications
    (user_id, actor_id, type, title, body, ref_id, created_at)
  VALUES
    (v_post_owner, NEW.user_id, 'comment',
     'Novo comentário',
     v_actor_label || ': ' || v_preview,
     NEW.post_id::text, now());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_comment ON public.comments;
CREATE TRIGGER trg_notify_on_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();
