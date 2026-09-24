-- ════════════════════════════════════════════════════════════════════
-- PARTE B — Gestão de Obras: tabelas + RLS (2026-09-24)
-- ════════════════════════════════════════════════════════════════════
-- Tile "Gestão de Obras" (pintor): o GESTOR cadastra obras, a equipe e a
-- escala; o FUNCIONÁRIO (se tiver conta no app) aceita o convite e vê a
-- própria agenda. Protótipo: https://claude.ai/artifact/XoADjescHo2T7Ww8ULs6fU
--
-- Regras de segurança (as mesmas das auditorias):
--  * RLS em tudo; função em policy embrulhada em (SELECT …) (perf 09-13);
--  * colunas de subquery correlacionada SEMPRE qualificadas (bug do pentest
--    09-18: `user_id` solto resolvia pra tabela errada);
--  * o FUNCIONÁRIO não tem policy direta em nenhuma tabela: ele só lê/age
--    por RPC SECURITY DEFINER (parte C), que devolve só o necessário —
--    nunca `valor`/`observacoes` da obra nem a diária dos colegas;
--  * ninguém coloca um usuário do app como "ativo" numa equipe sem o
--    aceite dele (trigger protect_obra_equipe, parte C);
--  * anon sem acesso nenhum.
-- Idempotente. Rodar ANTES da parte C.

CREATE TABLE IF NOT EXISTS public.obras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  cliente text CHECK (char_length(cliente) <= 120),
  endereco text CHECK (char_length(endereco) <= 300),
  status text NOT NULL DEFAULT 'planejada'
    CHECK (status IN ('planejada', 'em_andamento', 'pausada', 'concluida')),
  inicio date,
  fim date,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  valor numeric(12,2) CHECK (valor >= 0),
  observacoes text CHECK (char_length(observacoes) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fim IS NULL OR inicio IS NULL OR fim >= inicio)
);
CREATE INDEX IF NOT EXISTS idx_obras_owner ON public.obras (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.obra_equipe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  membro_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 80),
  telefone text CHECK (char_length(telefone) <= 20),
  funcao text CHECK (char_length(funcao) <= 60),
  diaria numeric(10,2) CHECK (diaria >= 0),
  status text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('convidado', 'ativo', 'recusado', 'saiu')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (membro_id IS NULL OR membro_id <> gestor_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_obra_equipe_membro
  ON public.obra_equipe (gestor_id, membro_id) WHERE membro_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obra_equipe_membro
  ON public.obra_equipe (membro_id) WHERE membro_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.obra_escala (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  equipe_id uuid NOT NULL REFERENCES public.obra_equipe(id) ON DELETE CASCADE,
  dia date NOT NULL,
  hora_inicio time,
  hora_fim time,
  tarefa text CHECK (char_length(tarefa) <= 200),
  presenca text NOT NULL DEFAULT 'pendente'
    CHECK (presenca IN ('pendente', 'confirmada', 'faltou')),
  notificado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, equipe_id, dia)
);
CREATE INDEX IF NOT EXISTS idx_obra_escala_equipe_dia ON public.obra_escala (equipe_id, dia);
CREATE INDEX IF NOT EXISTS idx_obra_escala_obra_dia ON public.obra_escala (obra_id, dia);

DROP TRIGGER IF EXISTS trg_obras_updated_at ON public.obras;
CREATE TRIGGER trg_obras_updated_at BEFORE UPDATE ON public.obras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_obra_equipe_updated_at ON public.obra_equipe;
CREATE TRIGGER trg_obra_equipe_updated_at BEFORE UPDATE ON public.obra_equipe
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.obras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_equipe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_escala ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.obras, public.obra_equipe, public.obra_escala FROM anon;

-- obras: só o dono (admin lê pra suporte). O orçamento vinculado tem que
-- ser do próprio dono.
DROP POLICY IF EXISTS obras_owner_all ON public.obras;
CREATE POLICY obras_owner_all ON public.obras
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR (SELECT public.is_portal_admin()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      obras.quote_id IS NULL
      OR EXISTS (SELECT 1 FROM public.quotes q
                  WHERE q.id = obras.quote_id AND q.painter_id = (SELECT auth.uid()))
    )
  );

-- obra_equipe: só o gestor. O funcionário responde convite por RPC.
DROP POLICY IF EXISTS obra_equipe_gestor_all ON public.obra_equipe;
CREATE POLICY obra_equipe_gestor_all ON public.obra_equipe
  FOR ALL TO authenticated
  USING (gestor_id = (SELECT auth.uid()) OR (SELECT public.is_portal_admin()))
  WITH CHECK (gestor_id = (SELECT auth.uid()));

-- obra_escala: só o gestor dono da obra, e só escalando gente ATIVA da
-- PRÓPRIA equipe (senão daria pra escalar o funcionário de outro gestor).
DROP POLICY IF EXISTS obra_escala_gestor_all ON public.obra_escala;
CREATE POLICY obra_escala_gestor_all ON public.obra_escala
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.obras o
             WHERE o.id = obra_escala.obra_id AND o.owner_id = (SELECT auth.uid()))
    OR (SELECT public.is_portal_admin())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.obras o
             WHERE o.id = obra_escala.obra_id AND o.owner_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.obra_equipe m
                 WHERE m.id = obra_escala.equipe_id
                   AND m.gestor_id = (SELECT auth.uid())
                   AND m.status = 'ativo')
  );

-- Financeiro e Anotações ligados à obra. `categoria` separa os gastos
-- (sugestão do pintor Léo): material, mão de obra, veículo, transporte.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS obra_id uuid
  REFERENCES public.obras(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS categoria text;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_categoria_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_categoria_check
  CHECK (categoria IS NULL OR categoria IN ('material', 'mao_de_obra', 'veiculo', 'transporte', 'outros'));
CREATE INDEX IF NOT EXISTS idx_jobs_obra ON public.jobs (obra_id) WHERE obra_id IS NOT NULL;

ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS obra_id uuid
  REFERENCES public.obras(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notes_obra ON public.notes (obra_id) WHERE obra_id IS NOT NULL;
