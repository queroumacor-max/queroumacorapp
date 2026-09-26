-- ============================================================================
-- 2026-09-26 (c) — Varredura de posts presos em `pending`, a cada 10 min.
--
-- O post nasce `pending` e quem o publica é o app chamando /api/posts/approve.
-- Se o app é fechado (ou a rede cai) entre gravar e aprovar, o post ficava
-- invisível pra sempre (2 casos no 1º dia). O cron chama
-- /api/posts/sweep-pending, que roda a mesma moderação do servidor.
--
-- Não pede nenhum valor pra colar: reaproveita as duas chaves que o push já
-- usa em `app_settings` (`push_notify_url` pra achar o domínio e
-- `push_internal_secret` pro header). Sem elas, a função não faz nada.
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_posts_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_push   text;
  v_secret text;
BEGIN
  SELECT value INTO v_push   FROM public.app_settings WHERE key = 'push_notify_url';
  SELECT value INTO v_secret FROM public.app_settings WHERE key = 'push_internal_secret';
  IF coalesce(v_push, '') = '' OR coalesce(v_secret, '') = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := replace(v_push, '/api/push-notify', '/api/posts/sweep-pending'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-internal-secret', v_secret),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_posts_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_posts_sweep() TO service_role;

SELECT cron.schedule('posts-sweep-pending', '*/10 * * * *', $$SELECT public.run_posts_sweep();$$);

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'run_posts_sweep existe' AS item,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'run_posts_sweep') AS ok
UNION ALL
SELECT 'cron agendado',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'posts-sweep-pending')
UNION ALL
SELECT 'push_notify_url aponta pra /api/push-notify',
       EXISTS (SELECT 1 FROM public.app_settings
                WHERE key = 'push_notify_url' AND value LIKE '%/api/push-notify%');
