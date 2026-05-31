-- Migration: 2026-05-31 — feature_flags (Grande#4)
-- Tabela + RPC pra feature flags com rollout gradual:
--   - `enabled` master switch;
--   - `rollout_percent` (0..100) — usa hashtext(user_id) determinístico,
--     então mesmo usuário sempre cai no mesmo lado do rollout (sem flap);
--   - `rollout_users` opcional — whitelist explícita (sempre dentro do bucket).
--
-- Convive com `is_portal_admin()` (init.sql linha 128) — admin gerencia
-- via dashboard `/admin/flags`.
--
-- Rodar manualmente no Supabase SQL Editor.

BEGIN;

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  rollout_percent int DEFAULT 100 CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
  rollout_users uuid[] DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed inicial: flags reais que o app já checa (ou checará logo).
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('ai_voice_chat', true, 'Seu Zé voice chat'),
  ('story_video', true, 'Vídeo em stories'),
  ('mp_checkout_loja', true, 'MP checkout pra loja'),
  ('next_app_canary', false, 'Habilita next-app pra subset de usuários'),
  ('full_text_search', false, 'Busca FTS'),
  ('onboarding_modal', true, 'Mostrar modal de boas-vindas')
ON CONFLICT (key) DO NOTHING;

-- RPC: resolve flag pra um usuário específico (ou anônimo).
-- Determinístico: hashtext(uuid) % 100 vs rollout_percent.
CREATE OR REPLACE FUNCTION public.is_feature_enabled(p_key text, p_user_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NOT enabled THEN false
    WHEN rollout_users IS NOT NULL AND p_user_id = ANY(rollout_users) THEN true
    WHEN rollout_percent = 100 THEN true
    WHEN p_user_id IS NULL THEN rollout_percent = 100
    ELSE (abs(hashtext(p_user_id::text)) % 100) < rollout_percent
  END
  FROM public.feature_flags
  WHERE key = p_key;
$$;

-- RLS: leitura pública (qualquer um pode checar se uma flag está ligada),
-- escrita só admin.
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read flags" ON public.feature_flags;
CREATE POLICY "Read flags" ON public.feature_flags FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin manage flags" ON public.feature_flags;
CREATE POLICY "Admin manage flags" ON public.feature_flags FOR ALL
  USING (is_portal_admin())
  WITH CHECK (is_portal_admin());

-- Trigger pra atualizar updated_at automaticamente.
CREATE OR REPLACE FUNCTION public.feature_flags_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.feature_flags_set_updated_at();

COMMENT ON TABLE public.feature_flags IS 'Feature flags com rollout gradual por percent ou whitelist. Leitura pública, escrita só admin.';

COMMIT;
