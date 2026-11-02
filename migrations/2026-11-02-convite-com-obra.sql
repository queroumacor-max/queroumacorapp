-- Gestão de Obras: OBRA NO CONVITE (2026-11-02, pedido do usuário: "acho
-- que ele tá vinculando a pessoa a todas as obras quando eu chamo pra 1").
--
-- A equipe continua sendo do GESTOR (quem trabalha em cada dia segue
-- definido pela Escala). O que muda: o convite pode dizer PRA QUAL OBRA a
-- pessoa está sendo chamada. O aviso e a tela do convidado dizem o nome da
-- obra, e na Escala a pessoa aparece primeiro naquela obra. Outras obras do
-- mesmo gestor continuam podendo escalá-la.
--
-- Idempotente. Uma instrução por bloco (o editor do celular corta bloco
-- grande). Depende das migrations de 2026-09-24 (b e c).

-- 1. A obra do convite (opcional). Obra apagada → volta a "qualquer obra".
ALTER TABLE public.obra_equipe ADD COLUMN IF NOT EXISTS obra_id uuid REFERENCES public.obras(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_obra_equipe_obra ON public.obra_equipe (obra_id) WHERE obra_id IS NOT NULL;

-- 2. Só obra do PRÓPRIO gestor (sem isso, um PATCH direto no REST apontaria
-- pra obra de outra pessoa e o aviso vazaria o nome dela).
CREATE OR REPLACE FUNCTION public.check_equipe_obra() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN IF NEW.obra_id IS NULL THEN RETURN NEW; END IF; IF NOT EXISTS (SELECT 1 FROM public.obras o WHERE o.id = NEW.obra_id AND o.owner_id = NEW.gestor_id) THEN RAISE EXCEPTION 'Obra inválida.' USING ERRCODE = '42501'; END IF; RETURN NEW; END $$;

REVOKE ALL ON FUNCTION public.check_equipe_obra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_check_equipe_obra ON public.obra_equipe;

CREATE TRIGGER trg_check_equipe_obra BEFORE INSERT OR UPDATE OF obra_id, gestor_id ON public.obra_equipe FOR EACH ROW EXECUTE FUNCTION public.check_equipe_obra();

-- 3. Aviso do convite com o nome da obra (mesmo corpo de 2026-09-26, só o
-- texto muda quando há obra).
CREATE OR REPLACE FUNCTION public.notify_obra_convite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE v_nome text; v_obra text; BEGIN IF NEW.membro_id IS NULL OR NEW.status <> 'convidado' THEN RETURN NEW; END IF; IF TG_OP = 'UPDATE' AND OLD.status = 'convidado' THEN RETURN NEW; END IF; SELECT COALESCE(NULLIF(p.name, ''), 'Um profissional') INTO v_nome FROM public.profiles p WHERE p.id = NEW.gestor_id; IF NEW.obra_id IS NOT NULL THEN SELECT o.nome INTO v_obra FROM public.obras o WHERE o.id = NEW.obra_id AND o.owner_id = NEW.gestor_id; END IF; BEGIN INSERT INTO public.notifications (user_id, actor_id, type, title, body, ref_id) VALUES (NEW.membro_id, NEW.gestor_id, 'obra_convite', 'Convite pra equipe', COALESCE(v_nome, 'Um profissional') || CASE WHEN v_obra IS NOT NULL THEN ' te convidou pra obra ' || left(v_obra, 80) || '.' ELSE ' te convidou pra equipe de obras dele.' END, NEW.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notify_obra_convite: %', SQLERRM; END; RETURN NEW; END $$;

-- 4. O convidado vê o NOME da obra (só o nome — nunca valor, endereço nem
-- observações). Mudou o tipo de retorno → DROP antes do CREATE.
DROP FUNCTION IF EXISTS public.meus_convites_equipe();

CREATE FUNCTION public.meus_convites_equipe() RETURNS TABLE (id uuid, gestor_nome text, gestor_tag text, funcao text, created_at timestamptz, obra_nome text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT e.id, p.name, COALESCE(p.tag, p.username), e.funcao, e.created_at, o.nome FROM public.obra_equipe e JOIN public.profiles p ON p.id = e.gestor_id LEFT JOIN public.obras o ON o.id = e.obra_id AND o.owner_id = e.gestor_id WHERE e.membro_id = (SELECT auth.uid()) AND e.status = 'convidado' ORDER BY e.created_at DESC LIMIT 20; $$;

REVOKE ALL ON FUNCTION public.meus_convites_equipe() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.meus_convites_equipe() TO authenticated;

-- Conferência: as 4 linhas têm que voltar ok = true.
SELECT 'coluna obra_equipe.obra_id' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'obra_equipe' AND column_name = 'obra_id') AS ok UNION ALL SELECT 'trava: só obra do gestor', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_check_equipe_obra' AND NOT tgisinternal) UNION ALL SELECT 'convite mostra a obra', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'meus_convites_equipe' AND pg_get_function_result(oid) LIKE '%obra_nome%') UNION ALL SELECT 'anon sem EXECUTE', NOT has_function_privilege('anon', 'public.meus_convites_equipe()', 'EXECUTE');
