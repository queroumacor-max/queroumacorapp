-- ════════════════════════════════════════════════════════════════════
-- CORREÇÃO DE SEGURANÇA — 2026-10-25 (achada testando as compras in-app).
--
-- O PROBLEMA: as travas protect_profile_columns (impede o usuário de se
-- dar PRO/admin/verificado e de mexer em pro_expires_at) e
-- protect_order_columns (impede marcar pedido como pago) eram SECURITY
-- DEFINER e decidiam quem é "confiável" por `current_user`. Dentro de
-- uma função SECURITY DEFINER, `current_user` é SEMPRE o DONO da função
-- (postgres) — então a checagem dava "confiável" pra todo mundo e a
-- trava não travava nada. Provado em Postgres 16 local com o corpo
-- EXATO da migration de 2026-09-17: um usuário logado fez
--   UPDATE profiles SET is_pro = true, pro_expires_at = '2099-01-01'
-- no próprio perfil e virou PRO até 2099, sem registro de bloqueio.
-- Com o PRO passando a ser pago, isso é PRO de graça pra quem souber
-- chamar a API.
--
-- A CORREÇÃO: as duas viram SECURITY INVOKER — o mesmo padrão que a
-- trava de moderação de posts (enforce_post_moderation) já usa e que
-- funciona. Aí `current_user` é quem está executando de verdade:
--   - pedido direto do app/REST → 'authenticated' → não confiável;
--   - dentro de função nossa SECURITY DEFINER (redeem_pro_with_points,
--     set_pro_subscription, admin_delete_user…) → 'postgres' → confiável;
--   - service_role (rotas do servidor) → confiável;
--   - admin do portal → is_portal_admin() continua liberando.
-- O registro do bloqueio em audit_events (que o usuário comum não pode
-- gravar) passa por uma função pequena SECURITY DEFINER.
--
-- Mesmo comportamento pretendido pelas migrations de 09-16/09-17 — só
-- que agora de verdade. Idempotente.
--
-- ANTES DE RODAR (conferência — mostra o estado atual):
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('protect_profile_columns','protect_order_columns');
--   (prosecdef = true é o estado quebrado)
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Registro do bloqueio (SECURITY DEFINER, evento fixo) ──
-- O ator é sempre auth.uid() (não vem de parâmetro) e o tipo do evento é
-- fixo: o máximo que alguém faz chamando direto é registrar a própria
-- tentativa.
CREATE OR REPLACE FUNCTION public._audit_privilege_blocked(p_target uuid, p_table text, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
  VALUES ('security.privilege_escalation_blocked', auth.uid(), p_target, left(coalesce(p_table, ''), 40), p_target,
          coalesce(p_meta, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  -- Falha ao registrar nunca derruba a escrita (o bloqueio em si já aconteceu).
  RAISE WARNING '_audit_privilege_blocked: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public._audit_privilege_blocked(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._audit_privilege_blocked(uuid, text, jsonb) TO authenticated, service_role;

-- ── 2. protect_profile_columns como SECURITY INVOKER ──
-- Corpo idêntico ao de 2026-09-17, trocando só o SECURITY e o INSERT do
-- registro pela função acima.
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_trusted boolean;
  v_attempted jsonb;
BEGIN
  v_trusted := public.is_portal_admin() OR current_user NOT IN ('anon', 'authenticated');

  -- INSERT: usuário comum não pode nascer com is_pro/portal/admin/verified
  -- ou datas de PRO já setadas.
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted THEN
      IF NEW.is_pro = true OR NEW.portal_access = true OR NEW.role = 'admin' OR NEW.verified = true
         OR NEW.pro_expires_at IS NOT NULL OR NEW.pro_grace_until IS NOT NULL THEN
        PERFORM public._audit_privilege_blocked(NEW.id, 'profiles',
          jsonb_build_object(
            'op', 'insert',
            'attempted', jsonb_build_object(
              'is_pro', NEW.is_pro, 'portal_access', NEW.portal_access, 'role', NEW.role,
              'verified', NEW.verified, 'pro_expires_at', NEW.pro_expires_at,
              'pro_grace_until', NEW.pro_grace_until),
            'caller_role', current_user));
        NEW.is_pro := false;
        NEW.portal_access := false;
        NEW.verified := false;
        NEW.pro_expires_at := NULL;
        NEW.pro_grace_until := NULL;
        IF NEW.role = 'admin' THEN NEW.role := 'pintor'; END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: reverte mudança de flags/datas privilegiadas se não-confiável
  -- e grava QUAIS colunas foram tentadas (old + attempted), uma linha só
  -- por statement (não uma por coluna) pra não inflar audit_events.
  IF TG_OP = 'UPDATE' THEN
    IF NOT v_trusted THEN
      v_attempted := '{}'::jsonb;
      IF OLD.is_pro IS DISTINCT FROM NEW.is_pro THEN
        v_attempted := v_attempted || jsonb_build_object('is_pro', jsonb_build_object('old', OLD.is_pro, 'attempted', NEW.is_pro));
        NEW.is_pro := OLD.is_pro;
      END IF;
      IF OLD.portal_access IS DISTINCT FROM NEW.portal_access THEN
        v_attempted := v_attempted || jsonb_build_object('portal_access', jsonb_build_object('old', OLD.portal_access, 'attempted', NEW.portal_access));
        NEW.portal_access := OLD.portal_access;
      END IF;
      IF OLD.role IS DISTINCT FROM NEW.role THEN
        v_attempted := v_attempted || jsonb_build_object('role', jsonb_build_object('old', OLD.role, 'attempted', NEW.role));
        NEW.role := OLD.role;
      END IF;
      IF OLD.verified IS DISTINCT FROM NEW.verified THEN
        v_attempted := v_attempted || jsonb_build_object('verified', jsonb_build_object('old', OLD.verified, 'attempted', NEW.verified));
        NEW.verified := OLD.verified;
      END IF;
      IF OLD.pro_expires_at IS DISTINCT FROM NEW.pro_expires_at THEN
        v_attempted := v_attempted || jsonb_build_object('pro_expires_at', jsonb_build_object('old', OLD.pro_expires_at, 'attempted', NEW.pro_expires_at));
        NEW.pro_expires_at := OLD.pro_expires_at;
      END IF;
      IF OLD.pro_grace_until IS DISTINCT FROM NEW.pro_grace_until THEN
        v_attempted := v_attempted || jsonb_build_object('pro_grace_until', jsonb_build_object('old', OLD.pro_grace_until, 'attempted', NEW.pro_grace_until));
        NEW.pro_grace_until := OLD.pro_grace_until;
      END IF;

      IF v_attempted <> '{}'::jsonb THEN
        PERFORM public._audit_privilege_blocked(NEW.id, 'profiles',
          jsonb_build_object('op', 'update', 'attempted', v_attempted, 'caller_role', current_user));
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;


-- ── 3. protect_order_columns como SECURITY INVOKER ──
-- O corpo (2026-09-16) não lê nenhuma tabela, só recalcula o total a
-- partir dos itens do próprio pedido — basta trocar o modo.
ALTER FUNCTION public.protect_order_columns() SECURITY INVOKER;

-- ── Conferência (uma linha por item, ok = true) ──
SELECT 'protect_profile_columns é INVOKER' AS item, NOT prosecdef AS ok FROM pg_proc WHERE oid = 'public.protect_profile_columns()'::regprocedure
UNION ALL SELECT 'protect_order_columns é INVOKER', NOT prosecdef FROM pg_proc WHERE oid = 'public.protect_order_columns()'::regprocedure
UNION ALL SELECT 'trava de perfil ligada', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_profile_columns' AND NOT tgisinternal)
UNION ALL SELECT 'trava de pedido ligada', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_order_columns' AND NOT tgisinternal)
UNION ALL SELECT 'registro de bloqueio existe', EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_audit_privilege_blocked');
