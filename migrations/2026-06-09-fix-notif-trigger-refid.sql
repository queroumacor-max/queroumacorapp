-- SQL Wave 14 (2026-06-09) — hotfix dos triggers da Wave 13: ref_id é uuid
-- ─────────────────────────────────────────────────────────────────────────
-- Bug: o user `fabio` tentou comentar e estourou:
--   column "ref_id" is of type uuid but expression is of type text
--
-- Causa: triggers da Wave 13 (notify_on_like / notify_on_comment) faziam
-- INSERT em notifications.ref_id passando NEW.post_id::text. O schema
-- declarado em supabase_init.sql:1015 é `ref_id text`, mas o banco real
-- está com `ref_id uuid` (alteração manual sem migration documentada).
-- Resultado: todo INSERT em likes/comments aborta a transação e o user
-- nem consegue interagir com o feed.
--
-- Fix: remover o ::text. NEW.post_id é uuid (PK de posts), serve direto
-- na coluna uuid. Se a coluna voltar a ser text um dia, Postgres faz
-- cast implícito uuid→text. Universal.
--
-- Idempotente — CREATE OR REPLACE FUNCTION pode rodar várias vezes.
-- Triggers da Wave 13 continuam apontando pras mesmas functions, não
-- precisam ser recriados.

CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post_owner uuid;
  v_actor_label text;
BEGIN
  SELECT user_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
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
     NEW.post_id, now());
  RETURN NEW;
END $$;

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
     NEW.post_id, now());
  RETURN NEW;
END $$;
