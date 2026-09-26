-- 2026-09-26 — Financeiro: "Lançar custo" atômico (clique duplo / duas abas)
--
-- `incrementCost` (next-app/lib/services/financeiro.ts) lia `material_cost`
-- e regravava `atual + delta`: dois lançamentos chegando juntos liam o mesmo
-- valor e um SOBRESCREVIA o outro (custo perdido). Esta função faz a soma
-- dentro de um UPDATE só, atômico no Postgres.
--
-- SECURITY INVOKER de propósito: roda com a permissão de quem chama, então a
-- RLS de `jobs` continua valendo; o `painter_id = auth.uid()` é redundância.
-- Zero linhas (lançamento inexistente / de outro pintor) → devolve NULL, e o
-- app trata como erro.
--
-- O app TOLERA a função ausente (42883/PGRST202): cai no ler-e-regravar
-- antigo. Idempotente — pode rodar de novo.

CREATE OR REPLACE FUNCTION public.increment_material_cost(p_id uuid, p_delta numeric)
RETURNS numeric
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.jobs
     SET material_cost = GREATEST(0, coalesce(material_cost, 0) + p_delta)
   WHERE id = p_id
     AND painter_id = (SELECT auth.uid())
  RETURNING material_cost
$$;

REVOKE ALL ON FUNCTION public.increment_material_cost(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_material_cost(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_material_cost(uuid, numeric) TO authenticated;

-- Conferência (só leitura): as 3 linhas devem voltar ok = true.
SELECT 'funcao_existe' AS item,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_material_cost'
               AND pronamespace = 'public'::regnamespace) AS ok
UNION ALL
SELECT 'security_invoker',
       COALESCE((SELECT NOT prosecdef FROM pg_proc WHERE proname = 'increment_material_cost'
                 AND pronamespace = 'public'::regnamespace), false)
UNION ALL
SELECT 'anon_sem_execute',
       NOT has_function_privilege('anon', 'public.increment_material_cost(uuid, numeric)', 'EXECUTE');
