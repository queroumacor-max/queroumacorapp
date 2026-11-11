-- Leitura automática dos murais: de "12 murais de 4 em 4 horas" para "TODOS
-- os murais ativos a cada 2 dias, em horário alternado" (2026-11-11, pedido do
-- usuário). O cron bate de 15 em 15 min, mas a função só deixa passar em dia
-- sim, dia não (a contar de 12/11/2026) e dentro de uma janela de 3 h cujo
-- começo roda entre 9h, 14h, 11h e 16h de Brasília. 12 chamadas x 12 murais
-- = até 144 por janela (hoje são 120). Fora da janela não chama nada.
CREATE OR REPLACE FUNCTION public.run_oportunidades_varredura_alternada() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$ DECLARE agora timestamp := now() AT TIME ZONE 'America/Sao_Paulo'; d int := agora::date - date '2026-11-12'; ini int; BEGIN IF d < 0 OR d % 2 <> 0 THEN RETURN; END IF; ini := (ARRAY[9,14,11,16])[((d / 2) % 4) + 1]; IF extract(hour FROM agora) < ini OR extract(hour FROM agora) >= ini + 3 THEN RETURN; END IF; PERFORM public.run_oportunidades_varredura(); END; $$;

REVOKE ALL ON FUNCTION public.run_oportunidades_varredura_alternada() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.run_oportunidades_varredura_alternada() TO service_role;

SELECT cron.schedule('oportunidades-varredura', '7,22,37,52 * * * *', $$SELECT public.run_oportunidades_varredura_alternada();$$);

-- Conferência: as 2 linhas devem voltar ok = true.
SELECT 'funcao alternada existe' AS item, EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'run_oportunidades_varredura_alternada') AS ok UNION ALL SELECT 'cron de 15 em 15 chamando a alternada', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oportunidades-varredura' AND schedule = '7,22,37,52 * * * *' AND command LIKE '%alternada%');
