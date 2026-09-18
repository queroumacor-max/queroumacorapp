-- ============================================================================
-- 2026-09-18 — Bloco 21 (auditoria OWASP ASVS Final / Release Gate).
-- Três achados MEDIUM que exigem SQL, todos idempotentes (rodar quantas
-- vezes precisar). Os achados de código-only da mesma auditoria (Eruda sem
-- gate, Sentry sem mascarar exception/breadcrumbs, CI com fail-fast
-- desarmado, SSRF sem revalidar redirect, SVG aceito como imagem, ordem de
-- delivery_status) já foram corrigidos no repo, sem depender deste arquivo.
-- ============================================================================

BEGIN;

-- ─── A. RLS de `comments` tinha uma policy permissiva demais coexistindo
--        com a restritiva — MESMA classe de bug já corrigida pra `quotes`
--        em 2026-09-03 (DROP de "View quotes active" por USING(true)).
--
-- Policies SELECT em Postgres são PERMISSIVAS por padrão e somadas com OR.
-- `comments_select_auth` (USING(true), criada em 2026-06-06 como
-- recuperação pra um banco que tinha ficado sem NENHUMA policy de SELECT)
-- nunca foi removida depois que "View comments active" (que respeita
-- deleted_at/dono/admin) passou a existir de verdade — então ela sozinha
-- já libera QUALQUER usuário autenticado a ler TODO comentário, incluindo
-- os soft-deleted (moderação, undo-window), tornando a policy restritiva
-- inerte. Exploit: `GET /rest/v1/comments?deleted_at=not.is.null` com
-- qualquer JWT de usuário comum.
--
-- Only drop it — "View comments active" (2026-05-31, wave 8) já cobre
-- 100% dos casos legítimos (comentário vivo, ou dono/admin vendo o
-- soft-deleted). Sem risco de re-introduzir o bug de "SELECT retorna 0
-- linhas sem erro" que motivou a criação da comments_select_auth em
-- primeiro lugar, porque não estamos tocando em "View comments active".
DROP POLICY IF EXISTS "comments_select_auth" ON public.comments;

-- ─── B. `consent_log.user_id` era ON DELETE CASCADE — apagar a conta
--        apagava também a PROVA de que consentimento foi dado/revogado,
--        na exata tabela criada pra servir de trilha LGPD. Se um usuário
--        deletar a conta e depois disputar "vocês nunca tiveram meu
--        consentimento pra marketing", não sobra registro nenhum.
--        `audit_log.actor_id` já usa SET NULL — este é o padrão certo:
--        a LINHA sobrevive, só perde o vínculo com o auth.users apagado.
DO $$
DECLARE
  v_fk text;
BEGIN
  SELECT conname INTO v_fk
    FROM pg_constraint
   WHERE conrelid = 'public.consent_log'::regclass
     AND contype = 'f'
     AND confrelid = 'auth.users'::regclass;

  IF v_fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.consent_log DROP CONSTRAINT %I', v_fk);
  END IF;

  ALTER TABLE public.consent_log
    ADD CONSTRAINT consent_log_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

-- ─── C. Push de COMENTÁRIO ainda mandava até 80 chars de texto cru pra
--        tela de bloqueio. A redação de 2026-09-15 (migration
--        chat-safety-hardening) cobriu só `type='message'` — comentário
--        cai no ELSE e manda `notifications.body` verbatim, que
--        `notify_on_comment` monta como "<quem comentou>: <texto até 80
--        chars>". Curtida não tem texto livre (sem risco); não existem
--        hoje triggers de notificação pra pedido/orçamento (só
--        like/comment/message têm INSERT trigger em `notifications`), então
--        esses dois tipos não têm o mesmo problema.
--
-- `notifications.body` (usado DENTRO do app, em /notificacoes, onde a
-- pessoa já está logada e ali de propósito) NÃO muda — só o que SAI pelo
-- push é redigido, mesmo padrão já aplicado a 'message'.
CREATE OR REPLACE FUNCTION public.dispatch_push_on_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_target     text;
  v_rl         jsonb;
  v_push_title text;
  v_push_body  text;
  v_actor_name text;
BEGIN
  SELECT value INTO v_url    FROM app_settings WHERE key = 'push_notify_url';
  SELECT value INTO v_secret FROM app_settings WHERE key = 'push_internal_secret';
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  v_rl := public.check_rate_limit(NEW.user_id::text, 'push-dispatch', 20, 1);
  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RETURN NEW;
  END IF;

  v_target := CASE WHEN NEW.type = 'message' THEN '/chat' ELSE '/notificacoes' END;

  IF NEW.type = 'message' THEN
    SELECT name INTO v_actor_name FROM public.profiles WHERE id = NEW.actor_id;
    v_push_title := 'Nova mensagem';
    v_push_body := COALESCE(v_actor_name, 'Alguém') || ' enviou uma mensagem';
  ELSIF NEW.type = 'comment' THEN
    -- Achado 2026-09-18: antes caía no ELSE genérico e mandava
    -- `notifications.body` cru (até 80 chars do comentário real) pro push.
    SELECT name INTO v_actor_name FROM public.profiles WHERE id = NEW.actor_id;
    v_push_title := 'Novo comentário';
    v_push_body := COALESCE(v_actor_name, 'Alguém') || ' comentou no seu post';
  ELSE
    v_push_title := COALESCE(NEW.title, 'QueroUmaCor');
    v_push_body := COALESCE(NEW.body, '');
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object(
      'userIds', jsonb_build_array(NEW.user_id::text),
      'title',   v_push_title,
      'body',    v_push_body,
      'url',     v_target
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

COMMIT;

-- ─── Conferência (só leitura) ───────────────────────────────────────────────

SELECT 'comments_select_auth removida (só resta a policy restritiva)' AS item,
       NOT EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'comments'
            AND policyname = 'comments_select_auth'
       ) AS ok
UNION ALL SELECT 'View comments active continua existindo',
       EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'comments'
            AND policyname = 'View comments active'
       )
UNION ALL SELECT 'consent_log.user_id é ON DELETE SET NULL (não mais CASCADE)',
       EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = 'public.consent_log'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'auth.users'::regclass
            AND c.confdeltype = 'n'  -- 'n' = SET NULL
       )
UNION ALL SELECT 'dispatch_push_on_notification redige o texto de comentário no push',
       EXISTS (
         SELECT 1 FROM pg_proc
          WHERE proname = 'dispatch_push_on_notification'
            AND prosrc LIKE '%comentou no seu post%'
       )
ORDER BY 1;
