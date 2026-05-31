-- ============================================
-- SQL Wave 8 (2026-05-31) — Soft delete + undo
-- ============================================
-- Adiciona `deleted_at timestamptz` em tabelas que se beneficiam de undo,
-- atualiza as policies de SELECT pra esconder rows soft-deleted, cria
-- indexes parciais pra performance das queries ativas, e função de cleanup
-- (hard delete após 30 dias).
--
-- Filosofia:
--   - DELETE no service vira UPDATE SET deleted_at = now() (a UI mostra
--     snackbar com botão "Desfazer"; clear o deleted_at → row volta).
--   - RLS de SELECT esconde rows com deleted_at IS NOT NULL pra usuários
--     comuns. Admin (is_portal_admin()) ainda enxerga pra auditoria.
--   - cleanup_soft_deleted() roda hard delete em rows > 30 dias soft-deleted.
--     Pode ser chamada por cron (pg_cron extension) ou manualmente.
--
-- IMPORTANTE: Esta migration é idempotente (IF NOT EXISTS em ALTER + DROP
-- POLICY IF EXISTS antes do CREATE), seguro rodar 2x.

BEGIN;

-- ─── 1. Adicionar deleted_at em todas as tabelas relevantes ─────────────────
ALTER TABLE public.posts        ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.notes        ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.messages     ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.comments     ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.quotes       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.checklists   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ─── 2. Indexes parciais (otimiza queries que filtram deleted_at IS NULL) ───
-- Index parcial só indexa rows ativas — payload menor, query mais rápida.
CREATE INDEX IF NOT EXISTS idx_posts_active
  ON public.posts (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_active
  ON public.notes (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_active
  ON public.messages (conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_active
  ON public.comments (post_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_active
  ON public.quotes (painter_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_checklists_active
  ON public.checklists (user_id, created_at DESC) WHERE deleted_at IS NULL;

-- ─── 3. RLS — esconder soft-deleted rows ────────────────────────────────────
-- Pattern: dropar a policy antiga + recriar com `AND deleted_at IS NULL`
-- adicionando exceção pra owner (vê próprio soft-deleted pra poder
-- desfazer) e is_portal_admin() (auditoria).

-- posts: substituir "Posts are viewable by everyone" (todo mundo lia tudo)
-- por uma política que filtra deleted_at, mantém status approved e dá
-- janela ao próprio user + admins.
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON public.posts;
DROP POLICY IF EXISTS "View posts active" ON public.posts;
CREATE POLICY "View posts active" ON public.posts
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      status = 'approved'
      OR user_id = auth.uid()
      OR public.is_portal_admin()
    )
  );

-- notes: dono vê próprias (incluindo soft-deleted, pra desfazer);
-- admins veem tudo.
DROP POLICY IF EXISTS "Users can manage own notes" ON public.notes;
DROP POLICY IF EXISTS "Notes select active" ON public.notes;
DROP POLICY IF EXISTS "Notes write own" ON public.notes;
-- A policy original era FOR ALL; agora a gente split em SELECT (com filtro
-- deleted_at relaxado pro dono) + INSERT/UPDATE/DELETE separados.
CREATE POLICY "Notes select active" ON public.notes
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id OR public.is_portal_admin()
  );
CREATE POLICY "Notes write own" ON public.notes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- messages: dropa e recria filtrando soft-deleted (admin ainda vê tudo
-- pelo policy separado de portal).
DROP POLICY IF EXISTS "Messages viewable by participants" ON public.messages;
DROP POLICY IF EXISTS "Messages select active" ON public.messages;
CREATE POLICY "Messages select active" ON public.messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND (auth.uid() = sender_id OR auth.uid() = receiver_id)
  );

-- comments: dropa as duas policies antigas (everyone + delete owners) e
-- recria pra esconder soft-deleted dos terceiros, mas mantém pra owner
-- e admin (auditoria).
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
DROP POLICY IF EXISTS "View comments active" ON public.comments;
CREATE POLICY "View comments active" ON public.comments
  FOR SELECT USING (
    deleted_at IS NULL
    OR user_id = auth.uid()
    OR public.is_portal_admin()
  );

-- quotes: dropa "viewable by everyone" e recria filtrando deleted_at.
-- O acesso original era irrestrito (USING true) — sane só restringir o
-- mínimo (esconder soft-deleted; quem precisa ver vê via owner check).
DROP POLICY IF EXISTS "Quotes are viewable by everyone" ON public.quotes;
DROP POLICY IF EXISTS "View quotes active" ON public.quotes;
CREATE POLICY "View quotes active" ON public.quotes
  FOR SELECT USING (
    deleted_at IS NULL
    OR client_id = auth.uid()
    OR painter_id = auth.uid()
    OR public.is_portal_admin()
  );

-- checklists: split do FOR ALL antigo pra esconder soft-deleted de terceiros
-- (não que terceiros vejam — o filter de user_id já restringe — mas
-- mantém consistência).
DROP POLICY IF EXISTS "Users can manage own checklists" ON public.checklists;
DROP POLICY IF EXISTS "Checklists select active" ON public.checklists;
DROP POLICY IF EXISTS "Checklists write own" ON public.checklists;
CREATE POLICY "Checklists select active" ON public.checklists
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id OR public.is_portal_admin()
  );
CREATE POLICY "Checklists write own" ON public.checklists
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── 4. Função de cleanup (hard delete após 30 dias) ────────────────────────
-- Pode ser chamada manualmente pelo admin (`SELECT cleanup_soft_deleted();`)
-- ou via cron (pg_cron) se ativarmos no Pro tier:
--   SELECT cron.schedule('soft-delete-cleanup', '0 3 * * *',
--     $$SELECT public.cleanup_soft_deleted();$$);
CREATE OR REPLACE FUNCTION public.cleanup_soft_deleted()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.posts      WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.notes      WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.messages   WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.comments   WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.quotes     WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  DELETE FROM public.checklists WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
$$;

-- Restringir execute: admins apenas (a função é SECURITY DEFINER, então
-- não queremos que usuário comum dispare cleanup).
REVOKE ALL ON FUNCTION public.cleanup_soft_deleted() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_soft_deleted() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_soft_deleted() TO service_role;

COMMIT;
