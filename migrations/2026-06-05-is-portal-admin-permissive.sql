-- SQL Wave 10 (2026-06-05) — is_portal_admin() reconhece todos os 3 sinais
-- ──────────────────────────────────────────────────────────────────────────
-- Motivação: o frontend (lib/policies.ts isAdmin) considera admin quem tem
-- QUALQUER UM de: is_admin=true | role='admin' | portal_access=true. Mas a
-- função SQL is_portal_admin() só checa portal_access. Resultado: usuário
-- com perfil admin via is_admin=true (mais comum) era visualmente reconhecido
-- como admin, mas as policies RLS que usam is_portal_admin() não confirmavam.
--
-- Concretamente: Wave 9 adicionou "Admins can delete any comment" usando
-- is_portal_admin(). Pra admins sem portal_access=true, essa policy nunca
-- granted, e moderação de comentários alheios continuava bloqueada.
--
-- Esta migration atualiza is_portal_admin() pra aceitar OR dos 3 sinais.
-- Em cascata, todas as policies que já usam is_portal_admin() (notes,
-- messages, comments, quotes, audit_log, etc.) ficam corretas pra todos
-- os admins.

CREATE OR REPLACE FUNCTION public.is_portal_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (
        portal_access = true
        OR is_admin = true
        OR role = 'admin'
      )
  );
$$;
