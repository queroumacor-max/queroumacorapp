-- ════════════════════════════════════════════════════════════════════
-- Remove 2 jobs de cron DUPLICADOS (2026-09-24).
--
-- Duas migrations agendaram a MESMA limpeza com nomes diferentes:
--   2026-09-17-security-observability-audit-trail.sql → 'cleanup-audit-events'
--                                                     + 'cleanup-notifications'
--   2026-09-17-privacy-audit-hardening.sql            → 'cleanup-old-audit-events'
--                                                     + 'cleanup-old-notifications'
-- Conferido no banco (cron.job): mesmo comando, mesmo horário
-- (domingo 03:00 e 04:00 UTC) — cada limpeza rodava 2x seguidas.
--
-- Fica o nome 'cleanup-old-*' (bate com o nome da função e com o
-- 'cleanup-old-errors'). A migration de observability foi alterada no repo
-- pra usar os mesmos nomes, então re-rodar qualquer uma das duas SUBSTITUI
-- o job (cron.schedule com nome existente) em vez de duplicar de novo.
--
-- Seguro: só desagenda a CÓPIA. A função continua rodando toda semana,
-- no mesmo horário, pelo job que fica.
-- ════════════════════════════════════════════════════════════════════

SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('cleanup-audit-events', 'cleanup-notifications');

-- Conferência: esperado 1 job por comando, e os 2 'cleanup-old-*' presentes.
SELECT command, count(*) AS jobs, string_agg(jobname, ', ') AS nomes
  FROM cron.job GROUP BY command ORDER BY jobs DESC, command;
