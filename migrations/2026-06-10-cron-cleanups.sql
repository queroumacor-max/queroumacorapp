-- SQL Wave 28 (2026-06-10) — agenda pg_cron pros 3 cleanups
-- ════════════════════════════════════════════════════════════════════
-- Funções de limpeza criadas em waves anteriores existem mas rodavam
-- só manualmente. Esse script agenda via pg_cron:
--
--   cleanup_old_audit_log()      — audit_log > 1 ano   — diário 03:00 UTC
--   cleanup_soft_deleted()       — rows deleted > 30d  — diário 03:30 UTC
--   cleanup_orphan_media()       — arquivos órfãos     — semanal dom 04:00 UTC
--
-- Requer extensão pg_cron habilitada (Supabase managed: já vem ligada
-- em projetos Pro/Team). Idempotente: cron.schedule em uma jobname
-- existente SUBSTITUI o schedule anterior.

-- Garantir extensão (no-op se já existe)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1) audit_log > 1 ano — diário 03:00 UTC
SELECT cron.schedule(
  'cleanup-audit-log',
  '0 3 * * *',
  $$SELECT public.cleanup_old_audit_log();$$
);

-- 2) soft-deleted (posts/comments/notes/messages/quotes/checklists) >
--    30 dias — diário 03:30 UTC
SELECT cron.schedule(
  'cleanup-soft-deleted',
  '30 3 * * *',
  $$SELECT public.cleanup_soft_deleted();$$
);

-- 3) Orphan media (bucket posts sem post referenciando, janela 7 dias) —
--    semanal domingo 04:00 UTC. SECURITY DEFINER, mas requer admin pra
--    execute_cleanup_orphan_media — chamamos a cleanup_orphan_media
--    direta (que só faz dry-run / scan). Pra EXECUTAR delete real,
--    admin precisa rodar execute_cleanup_orphan_media() manualmente
--    (ou um job admin separado).
SELECT cron.schedule(
  'scan-orphan-media',
  '0 4 * * 0',
  $$SELECT public.cleanup_orphan_media();$$
);

-- Pra inspecionar:
--   SELECT * FROM cron.job;
--
-- Pra desagendar:
--   SELECT cron.unschedule('cleanup-audit-log');
--   SELECT cron.unschedule('cleanup-soft-deleted');
--   SELECT cron.unschedule('scan-orphan-media');
