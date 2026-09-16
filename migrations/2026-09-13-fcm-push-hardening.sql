-- ============================================================================
-- 2026-09-13 — Auditoria Firebase/FCM/APNs/Push. Achados de banco, cada um
-- com o mecanismo de exploração descrito (não suspeita). Idempotente — pode
-- rodar mais de uma vez. Depende do `check_rate_limit(text,...)` da
-- migration `2026-09-13-security-audit-hardening.sql` (rodar aquela ANTES
-- desta, se ainda não rodou).
--
--   A) CRÍTICO — push_device_tokens tinha `UPDATE ... USING (true)`. A
--      intenção era permitir que um aparelho compartilhado, ao trocar de
--      conta, reatribuísse a PRÓPRIA linha (upsert por conflito de `token`)
--      pro novo dono. Mas `USING (true)` não distingue "minha linha antiga"
--      de "linha de qualquer um": qualquer usuário autenticado podia mandar
--          PATCH /rest/v1/push_device_tokens?user_id=eq.<vítima>
--          { "user_id": "<atacante>" }
--      direto no Supabase (sem passar pelo app) e SEQUESTRAR a linha de
--      QUALQUER outra pessoa — sem precisar conhecer o token dela, só o
--      user_id (que não é secreto). O `WITH CHECK` barra só o passo
--      seguinte (o atacante não consegue manter `user_id` da vítima), mas
--      não impede tomar posse da linha. Efeito: o dispositivo real da
--      vítima some da lista de destinatários até o app dela regravar o
--      token sozinho (auto-cura no próximo `ensureDeviceToken`, mas é uma
--      janela de negação de serviço real, provada só com a policy).
--      FIX: a policy de UPDATE volta a exigir `auth.uid() = user_id` nos
--      dois lados (USING e WITH CHECK) — ninguém edita linha alheia via
--      REST cru. A reatribuição legítima (troca de conta no mesmo
--      aparelho) passa a rodar só pela RPC `upsert_push_device_token`
--      (SECURITY DEFINER): ela SEMPRE grava `user_id = auth.uid()` lido de
--      dentro da função — nunca de um campo que o cliente manda — e só
--      identifica a linha em conflito pelo valor de `token` (uma string de
--      alta entropia que o próprio aparelho gerou, não um id previsível).
--
--   B) MÉDIO — nada limitava QUANTAS linhas um usuário cria pra si mesmo em
--      `push_device_tokens`/`push_subscriptions`. RLS de INSERT só garante
--      "é dono da linha", não "é uma quantidade razoável". Um usuário podia
--      inserir milhares de tokens/subscriptions falsos na PRÓPRIA conta e,
--      dali em diante, QUALQUER notificação endereçada a ele (curtida,
--      comentário, mensagem — nenhuma delas pede confirmação de quem
--      recebe) faz `/api/push-notify` disparar milhares de fetches
--      concorrentes pro FCM/push service no mesmo isolate — amplificação
--      de custo/carga que o alvo nem escolheu. Complementado no código
--      (app/api/push-notify/route.ts busca só os N mais recentes por
--      envio); aqui o teto trava a ORIGEM do problema, o tamanho da tabela.
--      FIX: trigger que mantém só os 20 dispositivos/subscriptions mais
--      recentes por usuário, apagando o excedente no próprio INSERT.
--
--   C) MÉDIO — `dispatch_push_on_notification` dispara 1 push por linha
--      inserida em `notifications`, sem teto por DESTINATÁRIO. Mensagem de
--      chat virou 1 notificação por mensagem em 2026-09-04 (antes agrupava
--      rajada) — ou seja, mandar 500 mensagens rápidas pro mesmo contato
--      aciona até 500 envios de push pra essa pessoa em um minuto, e o
--      mesmo vale pra curtida/comentário em sequência. O rate limit do
--      `/api/push-notify` é por IP de quem CHAMA a rota (o próprio banco,
--      via pg_net) — não por quem RECEBE o push.
--      FIX: `check_rate_limit(NEW.user_id::text, 'push-dispatch', 20, 1)`
--      antes do `net.http_post`. Estourou → a notificação continua sendo
--      gravada (o sininho do app funciona normal), só o ENVIO de push é
--      contido. Falha no rate limit (função indisponível) segue a mesma
--      filosofia best-effort do resto da função — não bloqueia o insert.
-- ============================================================================

-- ─── A. push_device_tokens: RLS estrita + RPC pra reatribuição segura ──────

CREATE OR REPLACE FUNCTION public.upsert_push_device_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Faça login pra registrar o token de push.';
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token vazio';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION 'platform inválida: %', p_platform;
  END IF;

  -- `user_id` vem SEMPRE de auth.uid() (lido aqui, servidor), nunca de um
  -- parâmetro — é isto que torna seguro reatribuir a linha de um dono
  -- anterior (aparelho compartilhado trocando de conta) sem reabrir a RLS
  -- pra PATCH arbitrário via REST.
  INSERT INTO public.push_device_tokens (user_id, token, platform, last_seen_at)
  VALUES (v_caller, p_token, p_platform, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = v_caller,
        platform = EXCLUDED.platform,
        last_seen_at = now();
END $$;

REVOKE ALL ON FUNCTION public.upsert_push_device_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_push_device_token(text, text) TO authenticated;

-- Policy de UPDATE volta a ser estritamente owner-only. A reatribuição
-- cross-user só acontece dentro da RPC acima (SECURITY DEFINER bypassa RLS
-- como dono da função, controlado pelo corpo dela — não pelo cliente).
DROP POLICY IF EXISTS "push_device_tokens owner update" ON public.push_device_tokens;
CREATE POLICY "push_device_tokens owner update" ON public.push_device_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── B. Teto de linhas por usuário (self-DoS / crescimento sem controle) ───

CREATE OR REPLACE FUNCTION public.cap_push_device_tokens_per_user()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.push_device_tokens
   WHERE user_id = NEW.user_id
     AND id NOT IN (
       SELECT id FROM public.push_device_tokens
        WHERE user_id = NEW.user_id
        ORDER BY last_seen_at DESC
        LIMIT 20
     );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cap_push_device_tokens ON public.push_device_tokens;
CREATE TRIGGER trg_cap_push_device_tokens
  AFTER INSERT ON public.push_device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.cap_push_device_tokens_per_user();

CREATE OR REPLACE FUNCTION public.cap_push_subscriptions_per_user()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.push_subscriptions
   WHERE user_id = NEW.user_id
     AND id NOT IN (
       SELECT id FROM public.push_subscriptions
        WHERE user_id = NEW.user_id
        ORDER BY last_seen_at DESC
        LIMIT 20
     );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cap_push_subscriptions ON public.push_subscriptions;
CREATE TRIGGER trg_cap_push_subscriptions
  AFTER INSERT ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.cap_push_subscriptions_per_user();

-- ─── C. Rate limit por destinatário no dispatch de push ────────────────────

CREATE OR REPLACE FUNCTION public.dispatch_push_on_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_url    text;
  v_secret text;
  v_target text;
  v_rl     jsonb;
BEGIN
  SELECT value INTO v_url    FROM app_settings WHERE key = 'push_notify_url';
  SELECT value INTO v_secret FROM app_settings WHERE key = 'push_internal_secret';
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  -- Teto por DESTINATÁRIO, não por quem originou a notificação — vale pra
  -- mensagem, curtida, comentário e qualquer fonte futura de `notifications`.
  -- A notificação em si já foi gravada (sininho funciona); só o disparo de
  -- PUSH é contido quando o mesmo usuário recebe muitas em pouco tempo.
  v_rl := public.check_rate_limit(NEW.user_id::text, 'push-dispatch', 20, 1);
  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RETURN NEW;
  END IF;

  v_target := CASE WHEN NEW.type = 'message' THEN '/chat' ELSE '/notificacoes' END;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object(
      'userIds', jsonb_build_array(NEW.user_id::text),
      'title',   COALESCE(NEW.title, 'QueroUmaCor'),
      'body',    COALESCE(NEW.body, ''),
      'url',     v_target
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort: falha de rede/pg_net/rate-limit não pode bloquear o insert
  -- da notificação em si.
  RETURN NEW;
END $$;

-- O trigger já aponta pra esta função (não muda); CREATE OR REPLACE acima
-- já é suficiente, mantido aqui por clareza/idempotência.
DROP TRIGGER IF EXISTS trg_dispatch_push_notification ON public.notifications;
CREATE TRIGGER trg_dispatch_push_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_push_on_notification();

-- ─── Conferência (só leitura) ───────────────────────────────────────────────

SELECT 'push_device_tokens UPDATE exige auth.uid()=user_id' AS item,
       EXISTS (
         SELECT 1 FROM pg_policies
          WHERE tablename = 'push_device_tokens' AND policyname = 'push_device_tokens owner update'
            AND qual = '(auth.uid() = user_id)'
       ) AS ok
UNION ALL SELECT 'upsert_push_device_token existe (SECURITY DEFINER)',
       EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'upsert_push_device_token' AND p.prosecdef
       )
UNION ALL SELECT 'upsert_push_device_token sem GRANT pra anon/public',
       NOT EXISTS (
         SELECT 1 FROM information_schema.routine_privileges
          WHERE routine_schema = 'public' AND routine_name = 'upsert_push_device_token'
            AND grantee IN ('anon', 'PUBLIC')
       )
UNION ALL SELECT 'trigger de teto em push_device_tokens existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cap_push_device_tokens')
UNION ALL SELECT 'trigger de teto em push_subscriptions existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cap_push_subscriptions')
UNION ALL SELECT 'dispatch_push_on_notification chama check_rate_limit',
       EXISTS (
         SELECT 1 FROM pg_proc
          WHERE proname = 'dispatch_push_on_notification'
            AND prosrc LIKE '%check_rate_limit%'
       )
ORDER BY 1;
