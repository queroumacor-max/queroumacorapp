-- 2026-10-31 — "se você me chama pra sua equipe, como eu saio depois?"
-- (relato do Fabio). A RPC sair_da_equipe existe desde 24/09, mas o
-- funcionário não tem como LISTAR as equipes em que está (ele não lê
-- obra_equipe direto, de propósito) — então a tela nunca teve o botão.
-- Esta função devolve só o necessário: id da linha (pra sair), nome/@ de
-- quem chefia e a função. Nunca diária nem telefone.

CREATE OR REPLACE FUNCTION public.minhas_equipes_obras() RETURNS TABLE (id uuid, gestor_nome text, gestor_tag text, funcao text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT e.id, p.name, COALESCE(p.tag, p.username), e.funcao FROM public.obra_equipe e JOIN public.profiles p ON p.id = e.gestor_id WHERE e.membro_id = (SELECT auth.uid()) AND e.status = 'ativo' ORDER BY p.name LIMIT 50; $$;

REVOKE ALL ON FUNCTION public.minhas_equipes_obras() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.minhas_equipes_obras() TO authenticated;

-- Conferência: as duas linhas têm que voltar true.
SELECT 'função existe' AS item, EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'minhas_equipes_obras') AS ok UNION ALL SELECT 'anon sem EXECUTE', NOT has_function_privilege('anon', 'public.minhas_equipes_obras()', 'EXECUTE');
