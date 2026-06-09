-- SQL de auditoria — checar se os índices da Wave 15 estão sendo usados.
-- NÃO MUDA NADA. Rodar e olhar o plano: deve aparecer "Index Scan using
-- idx_<nome>" no Node EXPLAIN. Se aparecer "Seq Scan" em alguma, o
-- índice não cobre o caso real e precisa ser refeito.
--
-- Cole CADA query separadamente no SQL Editor pra ver o plano de cada.

-- 1) fetchComments: comentários ativos de UM post, ordem ASC
EXPLAIN ANALYZE
SELECT id, post_id, user_id, text, created_at
FROM public.comments
WHERE post_id = (SELECT id FROM public.posts LIMIT 1)
  AND deleted_at IS NULL
ORDER BY created_at ASC
LIMIT 50;

-- 2) Badge sininho: contagem de notifs não-lidas de UM user
EXPLAIN ANALYZE
SELECT count(*)
FROM public.notifications
WHERE user_id = (SELECT id FROM auth.users LIMIT 1)
  AND read = false;

-- 3) Feed Todos: posts aprovados ativos, ordem DESC, paginação
EXPLAIN ANALYZE
SELECT id, user_id, caption, media_url, created_at
FROM public.posts
WHERE status = 'approved'
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 30;

-- Bônus: ver tamanho dos índices Wave 15
SELECT
  schemaname || '.' || indexname AS index,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size,
  idx_scan AS scans
FROM pg_stat_user_indexes
WHERE indexname IN (
  'idx_comments_post_active_created',
  'idx_notifications_user_unread_created',
  'idx_posts_approved_active_created'
);
