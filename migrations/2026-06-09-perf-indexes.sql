-- SQL Wave 15 (2026-06-09) — índices de performance no caminho crítico
-- ───────────────────────────────────────────────────────────────────────
-- Auditoria de perf identificou 3 queries hot-path sem índice ideal,
-- gerando scan sequencial em tabelas que crescem rápido:
--
-- 1) fetchComments() em postInteractions.ts faz
--      WHERE post_id = ? AND deleted_at IS NULL ORDER BY created_at ASC
--    Sem índice composite, scan em comments cresce O(N) por post popular.
--
-- 2) useUnreadNotificationCount faz
--      SELECT COUNT(*) WHERE user_id = ? AND read = false
--    Sem composite (user_id, read), conta varre todas as notifs do user.
--
-- 3) Feed "Todos" (FeedView default) faz
--      WHERE status = 'approved' AND deleted_at IS NULL ORDER BY created_at DESC
--    O índice atual idx_posts_status_created cobre status+created_at mas
--    sem filtro WHERE deleted_at IS NULL — PG ainda checa cada row.
--
-- CONCURRENTLY: cria índice sem lockear a tabela. Cada CREATE INDEX abaixo
-- precisa rodar SEPARADAMENTE no SQL Editor (Supabase não aceita múltiplos
-- CONCURRENTLY na mesma transação). Cola um por vez.

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_comments_post_active_created
  ON public.comments (post_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_notifications_user_unread_created
  ON public.notifications (user_id, created_at DESC)
  WHERE read = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_posts_approved_active_created
  ON public.posts (created_at DESC)
  WHERE status = 'approved' AND deleted_at IS NULL;
