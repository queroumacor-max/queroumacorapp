-- 2026-09-09 — ai_usage: soltar o CHECK de `feature`.
--
-- POR QUÊ: a tabela nasceu (Wave 7, 2026-05-31) com
--   CHECK (feature IN ('chat_ai','caption','transcribe','tts','generate_logo',
--     'area_from_photo','pricing_suggest','fin_analysis','crm_draft',
--     'agenda_order','resolve_color','moderate','moderate_video','ig_art'))
-- e as rotas que vieram depois gravam OUTROS nomes: 'alice', 'fe', 'senna'
-- (as personas), 'alice_tts', 'receipt_ocr'. O INSERT dessas volta 23514 e
-- o `recordAiUsageViaRest` só faz console.warn — ou seja, o uso das
-- personas NUNCA foi registrado. O relatório "Uso do app" do portal lê
-- essa tabela; sem este ALTER, Alice/Fê/Senna aparecem com zero.
--
-- O que faz: derruba o CHECK (o nome é o automático do Postgres pra CHECK
-- inline de coluna). A lista de features passa a ser a do código
-- (`recordAiUsage(... feature)`), que é onde ela sempre esteve de verdade.
-- Idempotente. Uma linha, pra colar no SQL Editor sem quebrar.

ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_feature_check;

-- Conferência (deve devolver ZERO linhas):
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.ai_usage'::regclass AND contype = 'c';
