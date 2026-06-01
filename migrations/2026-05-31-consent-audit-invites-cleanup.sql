-- Migration: 2026-05-31 — consent_log + audit_log + invite expires + orphan media cleanup
-- Cobre items: Privacidade#14 (trilha consentimento), Grande#5 (audit log),
--              Auth#14-15 (invite expiration), Uploads#13 (storage cleanup).
-- Rodar manualmente no Supabase SQL Editor.
--
-- Convive com schema existente:
--   - `audit_events` (init.sql) é granular por trigger; este `audit_log` é
--     o catálogo manual de ações administrativas (admin views, role changes,
--     refunds, deletions). Os dois não se substituem.
--   - `is_portal_admin()` já existe (init.sql linha 128) — reutilizamos.
--   - `invite_codes` NÃO existe no init.sql, então a migration cria do zero.

BEGIN;

-- ============================================
-- 1. consent_log (LGPD audit trail)
-- ============================================
CREATE TABLE IF NOT EXISTS public.consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('terms', 'privacy', 'marketing', 'cookies', 'data_processing')),
  consent_version text NOT NULL DEFAULT 'v1',
  consent_given boolean NOT NULL,
  ip_address text,
  user_agent text,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_consent_log_user ON public.consent_log(user_id, consent_type);
CREATE INDEX IF NOT EXISTS idx_consent_log_active ON public.consent_log(user_id, consent_type) WHERE revoked_at IS NULL;

ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own consent" ON public.consent_log;
CREATE POLICY "Users read own consent" ON public.consent_log FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own consent" ON public.consent_log;
CREATE POLICY "Users insert own consent" ON public.consent_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users revoke own consent" ON public.consent_log;
CREATE POLICY "Users revoke own consent" ON public.consent_log FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.consent_log IS 'LGPD audit trail — registra todas concessões e revogações de consentimento por usuário/tipo/versão.';

-- ============================================
-- 2. audit_log (auditoria de ações críticas)
-- ============================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_table text,
  target_id text,
  changes jsonb,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.audit_log(target_table, target_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin reads audit" ON public.audit_log;
CREATE POLICY "Admin reads audit" ON public.audit_log FOR SELECT
  USING (public.is_portal_admin());

-- Cleanup retroativo: > 1 ano deletado (LGPD)
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_log()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.audit_log WHERE created_at < now() - interval '1 year';
$$;

COMMENT ON TABLE public.audit_log IS 'Auditoria de ações críticas — admin views, role changes, refunds, deletions, etc. Retenção 1 ano.';

-- ============================================
-- 3. invite_codes (expiração de convites)
-- ============================================
-- Cria tabela do zero (não existe no init.sql) com expires_at default 30d.
CREATE TABLE IF NOT EXISTS public.invite_codes (
  code text PRIMARY KEY,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + interval '30 days'),
  used_count int NOT NULL DEFAULT 0,
  max_uses int DEFAULT 10,
  metadata jsonb
);

-- Caso a tabela já existisse com outra estrutura (defensivo):
ALTER TABLE public.invite_codes ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT (now() + interval '30 days');
ALTER TABLE public.invite_codes ADD COLUMN IF NOT EXISTS used_count int NOT NULL DEFAULT 0;
ALTER TABLE public.invite_codes ADD COLUMN IF NOT EXISTS max_uses int DEFAULT 10;
ALTER TABLE public.invite_codes ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.invite_codes ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.invite_codes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();

-- Backfill códigos antigos pra expirarem em 30 dias do INSERT
UPDATE public.invite_codes
SET expires_at = created_at + interval '30 days'
WHERE expires_at IS NULL;

-- Index por expires_at (sem now() no predicate — PostgreSQL exige IMMUTABLE
-- em index predicates, e now() é STABLE). A query "WHERE expires_at > now()"
-- ainda usa esse index pra range scan / ordenação em expires_at.
CREATE INDEX IF NOT EXISTS idx_invite_codes_expires
  ON public.invite_codes(expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Invite codes admin manage" ON public.invite_codes;
CREATE POLICY "Invite codes admin manage" ON public.invite_codes
  FOR ALL TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());

-- Função pra validar (caller pode usar pra checar antes de aceitar)
CREATE OR REPLACE FUNCTION public.invite_code_valid(p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invite_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses IS NULL OR used_count < max_uses)
  );
$$;

GRANT EXECUTE ON FUNCTION public.invite_code_valid(text) TO authenticated, anon;

COMMENT ON TABLE public.invite_codes IS 'Códigos de convite com expiração default de 30 dias e cap de usos.';

-- ============================================
-- 4. Storage cleanup function (arquivos órfãos)
-- ============================================
-- Cleanup de mídia órfã (post deletado mas arquivo ficou no bucket)
CREATE OR REPLACE FUNCTION public.cleanup_orphan_media()
RETURNS TABLE(bucket_id text, name text) LANGUAGE sql AS $$
  -- Posts: arquivos no bucket 'posts' sem post correspondente
  SELECT s.bucket_id, s.name
  FROM storage.objects s
  LEFT JOIN public.posts p ON (
    s.bucket_id = 'posts' AND p.media_url LIKE '%' || s.name
  )
  WHERE s.bucket_id = 'posts'
    AND p.id IS NULL
    AND s.created_at < now() - interval '7 days';
$$;

-- Função executável (deleta os órfãos) — CAUTION
CREATE OR REPLACE FUNCTION public.execute_cleanup_orphan_media()
RETURNS int LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  -- Só admin pode rodar
  IF NOT public.is_portal_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  WITH deleted AS (
    DELETE FROM storage.objects
    WHERE (bucket_id, name) IN (SELECT bucket_id, name FROM public.cleanup_orphan_media())
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_cleanup_orphan_media() TO authenticated;

COMMENT ON FUNCTION public.execute_cleanup_orphan_media() IS 'Admin-only: deleta arquivos órfãos do bucket posts. Rodar mensal via cron ou manual.';

COMMIT;
