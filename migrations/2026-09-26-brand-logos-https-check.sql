-- 2026-09-26 — auditoria "19 pontos": brand_logos.image_url só aceita https://
-- O dono grava a própria linha via REST; sem CHECK dava pra gravar
-- `javascript:...` e o portal (aba Camisetas) punha isso num <a href>.
-- O portal já filtra (urlSegura); isto é a trava no banco.
-- NOT VALID: vale pra toda linha NOVA/ALTERADA sem varrer as antigas.
-- Idempotente: rodar 2x não duplica. Se já houver logo antigo fora do https,
-- o bloco PULA (NOTICE) em vez de travar updates nessas linhas. Colar bloco por bloco se for no celular.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_logos_image_url_https' AND conrelid = 'public.brand_logos'::regclass) THEN IF EXISTS (SELECT 1 FROM public.brand_logos WHERE image_url !~* '^https://') THEN RAISE NOTICE 'PULADO brand_logos_image_url_https: ha logo antigo fora do https'; ELSE ALTER TABLE public.brand_logos ADD CONSTRAINT brand_logos_image_url_https CHECK (image_url ~* '^https://') NOT VALID; END IF; END IF; END $$;

-- Conferência: lista TODAS as constraints da tabela (não pergunta por nome).
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.brand_logos'::regclass ORDER BY conname;

-- Opcional, depois: linhas antigas que violariam (deveria voltar 0).
SELECT count(*) AS fora_do_https FROM public.brand_logos WHERE image_url !~* '^https://';
