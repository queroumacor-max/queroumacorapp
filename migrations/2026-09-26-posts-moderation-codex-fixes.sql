-- ============================================================================
-- 2026-09-26 (b) — Moderação de posts: correções do Codex no PR #435.
-- Roda DEPOIS de 2026-09-26-posts-moderation-server-side.sql. Idempotente.
--
-- 1. Editar LEGENDA ou LINK de post aprovado agora volta pra 'pending' (antes
--    só mídia voltava) — o texto novo passa pela moderação antes de aparecer.
--    O app, depois de editar a legenda, pede a reaprovação sozinho.
-- 2. `approve_post_moderated`: a aprovação vira compare-and-set. O servidor
--    lê o post, modera, e só grava 'approved' se mídia, legenda e link ainda
--    forem EXATAMENTE os que ele moderou (troca no meio da análise → false,
--    post segue pendente). Grava também as URLs das cópias imutáveis
--    (`posts/approved/<uid>/…`) e o hash calculado no servidor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_post_moderation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    RETURN NEW;
  END IF;

  IF public.is_portal_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status := OLD.status;
  END IF;
  IF NEW.media_url  IS DISTINCT FROM OLD.media_url
     OR NEW.media_urls IS DISTINCT FROM OLD.media_urls
     OR NEW.caption    IS DISTINCT FROM OLD.caption
     OR NEW.link_url   IS DISTINCT FROM OLD.link_url THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.approve_post_moderated(
  p_post_id uuid,
  p_old_media_url text,
  p_old_media_urls text[],
  p_old_caption text,
  p_old_link_url text,
  p_new_media_url text,
  p_new_media_urls text[],
  p_media_hash text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.posts
     SET status = 'approved',
         media_url = p_new_media_url,
         media_urls = p_new_media_urls,
         media_hash = coalesce(p_media_hash, media_hash)
   WHERE id = p_post_id
     AND status = 'pending'
     AND deleted_at IS NULL
     AND media_url  IS NOT DISTINCT FROM p_old_media_url
     AND media_urls IS NOT DISTINCT FROM p_old_media_urls
     AND caption    IS NOT DISTINCT FROM p_old_caption
     AND link_url   IS NOT DISTINCT FROM p_old_link_url
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END $$;

REVOKE ALL ON FUNCTION public.approve_post_moderated(uuid, text, text[], text, text, text, text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_post_moderated(uuid, text, text[], text, text, text, text[], text)
  TO service_role;

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'trigger volta pra pending ao editar legenda/link' AS item,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_post_moderation'
                 AND prosrc LIKE '%NEW.caption%' AND prosrc LIKE '%NEW.link_url%') AS ok
UNION ALL
SELECT 'approve_post_moderated existe',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'approve_post_moderated')
UNION ALL
SELECT 'authenticated sem EXECUTE em approve_post_moderated',
       NOT has_function_privilege('authenticated',
         'public.approve_post_moderated(uuid, text, text[], text, text, text, text[], text)', 'EXECUTE');
