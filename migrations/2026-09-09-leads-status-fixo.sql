-- 2026-09-09 — status 'fixo' em leads (pedido do usuário).
--
-- Telefone fixo, sem WhatsApp: a abordagem por template nunca chega (foi
-- boa parte dos 90 "não entregue" do incidente de hoje). Não é 'perdido':
-- o lead pode valer por outro canal. O portal já oferece a opção; este
-- arquivo só importa SE leads.status tiver um CHECK que não conhece o
-- valor (o portal avisa com o erro 23514 ao tentar salvar).
--
-- A tabela `leads` nasceu fora do repo, então não dá pra saber daqui se há
-- CHECK. Regra do CLAUDE.md: conferência de constraint LISTA, não pergunta
-- por nome. Rode a linha 1; se voltar vazio, não há o que fazer.

-- 1) CONFERÊNCIA (só leitura): todo CHECK de leads.
SELECT conname, pg_get_constraintdef(oid) AS definicao FROM pg_constraint WHERE conrelid = 'public.leads'::regclass AND contype = 'c';

-- 2) Só se a linha 1 mostrar um CHECK em `status`: trocar pelo nome que
--    apareceu em `conname` (o nome abaixo é o padrão do Postgres).
-- ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
-- ALTER TABLE public.leads ADD CONSTRAINT leads_status_check CHECK (status IN ('novo','contactado','qualificado','convertido','perdido','fixo'));
