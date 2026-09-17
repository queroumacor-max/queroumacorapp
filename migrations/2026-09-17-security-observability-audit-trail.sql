-- ════════════════════════════════════════════════════════════════════
-- 2026-09-17 — Auditoria de SECURITY LOGGING / MONITORING / AUDIT TRAILS
-- (pedido do usuário: "se alguém atacar, abusar ou comprometer parte do
-- sistema, conseguimos perceber, investigar, conter e reconstruir o que
-- aconteceu sem vazar dados sensíveis?").
--
-- Dois gaps de audit trail confirmados lendo o SQL vivo (não suposição):
--
--   1. `protect_profile_columns` (trigger anti-escalada de profiles)
--      REVERTE silenciosamente qualquer tentativa de auto-promoção
--      (is_pro/portal_access/role/verified/pro_expires_at/pro_grace_until)
--      — mas nunca deixou rastro da TENTATIVA em lugar nenhum. Hoje: se
--      alguém tentar `PATCH /rest/v1/profiles?id=eq.<self>
--      {"role":"admin"}` mil vezes, a defesa funciona (a coluna nunca
--      muda) mas ninguém percebe que alguém tentou.
--
--   2. `audit_profile_changes` (trigger que grava old->new em
--      audit_events pra toda mudança LEGÍTIMA de is_pro/portal_access)
--      NUNCA cobriu a coluna `role`, apesar de `protect_profile_columns`
--      tratar `role` como igualmente privilegiada. Ou seja: promoção OU
--      rebaixamento de admin feito por um admin de verdade (via
--      /api/admin/users, action set_role/promote/revoke) não tem
--      trilha old->new em lugar nenhum do banco — só o `audit_log`
--      (tabela manual, escrita pelo app) grava o valor NOVO, nunca o
--      valor anterior.
--
-- Fix: os DOIS triggers ganham o comportamento que faltava, mantendo
-- 100% do comportamento de bloqueio/permissão já existente (nenhuma
-- regra de negócio muda — só passa a deixar rastro). Idempotente
-- (CREATE OR REPLACE). Terceiro achado: `cleanup_old_audit_events()`,
-- `cleanup_old_notifications()` e `cleanup_rate_limits()` já existiam
-- como função mas NUNCA foram agendadas via pg_cron (as duas primeiras
-- tinham só um comentário `-- SELECT cron.schedule(...)` nunca
-- executado) — retention dessas 3 tabelas era manual-only. Agenda as 3.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- 1. `protect_profile_columns` — audita a TENTATIVA bloqueada antes de
--    revertê-la. Mesma lógica de trust (`is_portal_admin() OR
--    current_user NOT IN ('anon','authenticated')`) e o mesmo conjunto
--    de colunas protegidas do arquivo vigente
--    (migrations/2026-09-16-business-logic-security-audit.sql) — só
--    adiciona o INSERT em audit_events. SECURITY DEFINER já presente na
--    função (necessário pra poder escrever em audit_events, que nega
--    INSERT pra `authenticated` via RLS).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
        INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
        VALUES ('security.privilege_escalation_blocked', auth.uid(), NEW.id, 'profiles', NEW.id,
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
        INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
        VALUES ('security.privilege_escalation_blocked', auth.uid(), NEW.id, 'profiles', NEW.id,
          jsonb_build_object('op', 'update', 'attempted', v_attempted, 'caller_role', current_user));
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

-- Trigger já existe (uma única, canônica) — CREATE OR REPLACE da função
-- basta, não precisa recriar a trigger.


-- ════════════════════════════════════════════════════════════════════
-- 2. `audit_profile_changes` — passa a cobrir `role` (old->new), igual
--    já cobre is_pro/portal_access. Fecha o gap: promoção/rebaixamento
--    de admin feito por um admin de verdade ganha trilha no banco,
--    além do valor-novo-só que o `audit_log` (app-level) já grava.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.audit_profile_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_pro IS DISTINCT FROM OLD.is_pro OR NEW.pro_expires_at IS DISTINCT FROM OLD.pro_expires_at THEN
    INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
    VALUES ('pro_change', auth.uid(), NEW.id, 'profiles', NEW.id,
      jsonb_build_object('old_is_pro', OLD.is_pro, 'new_is_pro', NEW.is_pro,
        'old_expires_at', OLD.pro_expires_at, 'new_expires_at', NEW.pro_expires_at,
        'caller_role', current_user));
  END IF;
  IF NEW.portal_access IS DISTINCT FROM OLD.portal_access THEN
    INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
    VALUES ('portal_access_change', auth.uid(), NEW.id, 'profiles', NEW.id,
      jsonb_build_object('old', OLD.portal_access, 'new', NEW.portal_access, 'caller_role', current_user));
  END IF;
  -- NOVO (auditoria de observabilidade de segurança, 2026-09-17): `role`
  -- nunca teve trilha old->new aqui, só is_pro/portal_access — apesar de
  -- `protect_profile_columns` tratar as três como igualmente privilegiadas.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
    VALUES ('security.role_change', auth.uid(), NEW.id, 'profiles', NEW.id,
      jsonb_build_object('old_role', OLD.role, 'new_role', NEW.role, 'caller_role', current_user));
  END IF;
  RETURN NEW;
END $$;

-- Trigger já existe (trg_audit_profile_changes) — CREATE OR REPLACE da
-- função basta.


-- ════════════════════════════════════════════════════════════════════
-- 3. Agenda os 3 cleanups que já existiam como função mas nunca foram
--    postos no pg_cron (retention era manual-only). Mesmo padrão de
--    nomes/horários de migrations/2026-06-10-cron-cleanups.sql.
--    Idempotente: cron.schedule numa jobname existente SUBSTITUI o
--    schedule anterior.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- audit_events > 1 ano — semanal domingo 04:00 UTC (mesmo horário
-- sugerido, nunca executado, em supabase_init.sql).
SELECT cron.schedule(
  'cleanup-audit-events',
  '0 4 * * 0',
  $$SELECT public.cleanup_old_audit_events();$$
);

-- notifications > 90 dias — semanal domingo 03:00 UTC (mesmo horário
-- sugerido, nunca executado, em supabase_init.sql).
SELECT cron.schedule(
  'cleanup-notifications',
  '0 3 * * 0',
  $$SELECT public.cleanup_old_notifications();$$
);

-- rate_limits > 1 hora — de hora em hora (a janela da própria função é
-- de 1h; sem isso a tabela só encolhe se alguém rodar a função na mão).
SELECT cron.schedule(
  'cleanup-rate-limits',
  '0 * * * *',
  $$SELECT public.cleanup_rate_limits();$$
);


-- ════════════════════════════════════════════════════════════════════
-- Conferência (rodar depois — sem side effect, é só leitura)
-- ════════════════════════════════════════════════════════════════════
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'protect_profile_columns'
          AND prosrc LIKE '%security.privilege_escalation_blocked%') AS tentativa_bloqueada_e_auditada,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_profile_changes'
          AND prosrc LIKE '%security.role_change%') AS role_change_auditado,
  (SELECT count(*) FROM cron.job
   WHERE jobname IN ('cleanup-audit-events', 'cleanup-notifications', 'cleanup-rate-limits')) AS crons_agendados_esperado_3;
