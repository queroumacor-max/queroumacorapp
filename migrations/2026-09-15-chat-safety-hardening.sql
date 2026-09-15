-- ============================================================================
-- 2026-09-15 — Dois itens deixados pendentes na auditoria FCM/push de
-- 09-13, corrigidos agora por pedido do usuário. Idempotente. Depende de
-- `check_rate_limit(text,...)` — já rodado (migration
-- 2026-09-13-security-audit-hardening.sql).
--
--   A) Mensagem de chat nunca teve rate limit PRÓPRIO. O teto de 20/min
--      que a auditoria de FCM/push adicionou fica no DISPATCH DO PUSH —
--      contém o sintoma pro destinatário (não recebe notificação demais),
--      mas a linha em `messages` em si, fora do push, continuava
--      ilimitada. Um usuário podia mandar centenas de mensagens por
--      minuto pro MESMO contato via chamada direta ao Supabase
--      (bypassando qualquer UI) — é assédio/flood mesmo que o push
--      individual seja contido.
--      FIX: trigger BEFORE INSERT em `messages` com
--      `check_rate_limit(sender>receiver, 'chat-message', 30, 1)` — 30
--      mensagens/minuto por PAR remetente→destinatário, não por
--      remetente sozinho (pra não travar conta que atende muita gente
--      rápido, ex. a loja respondendo vários clientes). Estourou → o
--      INSERT é recusado com uma mensagem que contém "rate limit" — o
--      app já traduz esse texto pra "Muitas tentativas / Espere alguns
--      segundos" em `lib/errors-friendly.ts` (pattern já existente,
--      nenhuma mudança de client necessária). `type='system'` (marcador
--      interno, ex. `__STORE_ADDED__`) não conta pro limite. Falha na
--      checagem (função indisponível) NÃO bloqueia o envio — mesma
--      filosofia best-effort do resto do projeto.
--
--   B) `dispatch_push_on_notification` copiava `notifications.body` —
--      que pra mensagem inclui até 80 chars do texto real (ex. "Fulano:
--      manda o endereço que...") — direto pro payload do push. Decisão
--      do usuário: tirar o conteúdo da tela de bloqueio.
--      FIX: pra `type='message'`, o push manda um corpo GENÉRICO ("<nome
--      de quem mandou> enviou uma mensagem"), nunca o texto.
--      `notifications.body` (o que a tela /notificacoes usa DENTRO do
--      app, onde a pessoa já está logada e ali de propósito) NÃO muda —
--      só o que sai pelo push é redigido.
-- ============================================================================

-- ─── A. Rate limit por PAR remetente→destinatário em `messages` ───────────

CREATE OR REPLACE FUNCTION public.rate_limit_messages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rl  jsonb;
  v_key text;
BEGIN
  IF COALESCE(NEW.type, 'text') = 'system' THEN
    RETURN NEW;
  END IF;
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_key := NEW.sender_id::text || '>' || NEW.receiver_id::text;

  BEGIN
    v_rl := public.check_rate_limit(v_key, 'chat-message', 30, 1);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW; -- infra indisponível: não bloqueia o envio
  END;

  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'rate limit: muitas mensagens em pouco tempo, aguarde um instante';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rate_limit_messages ON public.messages;
CREATE TRIGGER trg_rate_limit_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_messages();

-- ─── B. Push de mensagem deixa de carregar o texto da conversa ─────────────

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

  -- Teto por DESTINATÁRIO (Wave FCM/push 09-13) — continua valendo pra
  -- qualquer fonte de `notifications`, não só mensagem.
  v_rl := public.check_rate_limit(NEW.user_id::text, 'push-dispatch', 20, 1);
  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RETURN NEW;
  END IF;

  v_target := CASE WHEN NEW.type = 'message' THEN '/chat' ELSE '/notificacoes' END;

  -- Push de mensagem NUNCA carrega o texto da conversa — só o
  -- `notifications.body` (usado dentro do app, na tela /notificacoes) tem
  -- o preview. Nome de quem mandou vem do `actor_id` já gravado na
  -- notificação; sem ele (perfil apagado etc.) cai num rótulo genérico em
  -- vez de vazar qualquer coisa ou quebrar o envio.
  IF NEW.type = 'message' THEN
    SELECT name INTO v_actor_name FROM public.profiles WHERE id = NEW.actor_id;
    v_push_title := 'Nova mensagem';
    v_push_body := COALESCE(v_actor_name, 'Alguém') || ' enviou uma mensagem';
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
  -- Best-effort: falha de rede/pg_net/rate-limit/lookup de nome não pode
  -- bloquear o insert da notificação em si.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dispatch_push_notification ON public.notifications;
CREATE TRIGGER trg_dispatch_push_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_push_on_notification();

-- ─── Conferência (só leitura) ───────────────────────────────────────────────

SELECT 'trigger de rate limit em messages existe' AS item,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rate_limit_messages') AS ok
UNION ALL SELECT 'rate_limit_messages chama check_rate_limit',
       EXISTS (
         SELECT 1 FROM pg_proc
          WHERE proname = 'rate_limit_messages' AND prosrc LIKE '%check_rate_limit%'
       )
UNION ALL SELECT 'dispatch_push_on_notification redige o texto da mensagem no push',
       EXISTS (
         SELECT 1 FROM pg_proc
          WHERE proname = 'dispatch_push_on_notification'
            AND prosrc LIKE '%enviou uma mensagem%'
       )
ORDER BY 1;
