-- Avisos agendados + push geral (2026-11-06, pedido do usuário: "agendar dia e horário
-- de Brasília", "pode fazer push geral").
-- Idempotente. Inclui as colunas de foto/vídeo (2026-11-06-announcements-media.sql)
-- para funcionar mesmo se aquele não tiver rodado.
-- publish_at = quando o aviso aparece no app (NULL = na hora). O portal grava
-- publish_at e created_at com a hora de sair.
-- Push: a cada minuto o pg_cron chama run_announcement_push(), que manda UM push
-- por aviso que entrou no ar para todo usuário com push ligado (push_device_tokens
-- / push_subscriptions), em lotes de 100 pela /api/push-notify (até 40 lotes por
-- minuto — a rota aceita 60 chamadas/min). Os avisos que já existem ficam marcados
-- como enviados: nada antigo dispara.
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS publish_at timestamptz;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS push_sent_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS push_done boolean NOT NULL DEFAULT false;
UPDATE public.announcements SET push_done = true, push_sent_at = COALESCE(push_sent_at, now()) WHERE push_done = false AND created_at < now() - interval '1 minute';
CREATE OR REPLACE VIEW public.announcements_public WITH (security_invoker = true) AS SELECT id, title, message, active, created_at, media_url, media_type, publish_at FROM public.announcements;
GRANT SELECT ON public.announcements_public TO anon, authenticated;
DROP POLICY IF EXISTS announcements_public_read ON public.announcements;
CREATE POLICY announcements_public_read ON public.announcements FOR SELECT USING (active = true AND (publish_at IS NULL OR publish_at <= now()));
CREATE OR REPLACE FUNCTION public.run_announcement_push() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_url text; v_secret text; a record; v_ids jsonb; v_lotes int := 0; v_n int;
BEGIN
  SELECT value INTO v_url    FROM app_settings WHERE key = 'push_notify_url';
  SELECT value INTO v_secret FROM app_settings WHERE key = 'push_internal_secret';
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN RETURN 0; END IF;
  FOR a IN SELECT id, title, message, push_sent_count FROM announcements
           WHERE active AND NOT push_done AND COALESCE(publish_at, created_at) <= now()
           ORDER BY COALESCE(publish_at, created_at) FOR UPDATE SKIP LOCKED LOOP
    LOOP
      EXIT WHEN v_lotes >= 40;
      SELECT jsonb_agg(u), count(*) INTO v_ids, v_n FROM (
        SELECT user_id::text AS u FROM (
          SELECT user_id FROM push_device_tokens UNION SELECT user_id FROM push_subscriptions
        ) t WHERE user_id IS NOT NULL ORDER BY user_id OFFSET a.push_sent_count LIMIT 100
      ) s;
      IF COALESCE(v_n, 0) = 0 THEN
        UPDATE announcements SET push_done = true, push_sent_at = COALESCE(push_sent_at, now()) WHERE id = a.id;
        EXIT;
      END IF;
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
        body := jsonb_build_object('userIds', v_ids, 'title', left(COALESCE(NULLIF(a.title, ''), 'QueroUmaCor'), 200),
                                   'body', left(COALESCE(a.message, ''), 180), 'url', '/notificacoes', 'tag', 'aviso-' || a.id::text));
      a.push_sent_count := a.push_sent_count + v_n;
      UPDATE announcements SET push_sent_count = a.push_sent_count, push_sent_at = COALESCE(push_sent_at, now()) WHERE id = a.id;
      v_lotes := v_lotes + 1;
      IF v_n < 100 THEN UPDATE announcements SET push_done = true WHERE id = a.id; EXIT; END IF;
    END LOOP;
    EXIT WHEN v_lotes >= 40;
  END LOOP;
  RETURN v_lotes;
END $$;
REVOKE ALL ON FUNCTION public.run_announcement_push() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('announcements-push', '* * * * *', $$SELECT public.run_announcement_push();$$);
-- Conferência (as 4 linhas devem voltar ok = true):
SELECT 'colunas' AS item, count(*) = 6 AS ok FROM information_schema.columns WHERE table_schema='public' AND table_name='announcements' AND column_name IN ('media_url','media_type','publish_at','push_sent_at','push_sent_count','push_done') UNION ALL SELECT 'view', count(*) = 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='announcements_public' AND column_name = 'publish_at' UNION ALL SELECT 'policy', count(*) = 1 FROM pg_policies WHERE tablename='announcements' AND policyname='announcements_public_read' AND qual LIKE '%publish_at%' UNION ALL SELECT 'cron', count(*) = 1 FROM cron.job WHERE jobname = 'announcements-push';
