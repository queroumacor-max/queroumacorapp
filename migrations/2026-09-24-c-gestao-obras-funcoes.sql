-- ════════════════════════════════════════════════════════════════════
-- PARTE C — Gestão de Obras: travas e funções (2026-09-24)
-- ════════════════════════════════════════════════════════════════════
-- Rodar DEPOIS da parte B. Idempotente. Toda função SECURITY DEFINER tem
-- SET search_path e EXECUTE só pra `authenticated` (anon nunca).

-- 1. Trava da equipe: o gestor NUNCA coloca um usuário do app como
--    "ativo" — só o próprio usuário, aceitando o convite. Também não dá
--    pra trocar de dono/membro depois de criado. Convite exige e-mail
--    confirmado, respeita bloqueio e tem teto (equipe e ritmo).
CREATE OR REPLACE FUNCTION public.protect_obra_equipe()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rl jsonb;
BEGIN
  IF public.is_portal_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.gestor_id := OLD.gestor_id;
    NEW.membro_id := OLD.membro_id;
  END IF;
  IF NEW.membro_id IS NULL THEN
    -- Funcionário sem conta: o gestor manda em tudo.
    IF NEW.status NOT IN ('ativo', 'saiu') THEN NEW.status := 'ativo'; END IF;
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT DISTINCT FROM NEW.membro_id THEN
    RETURN NEW; -- o próprio membro (via RPC de resposta)
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_email_verified() THEN
      RAISE EXCEPTION 'Confirme seu e-mail antes de convidar alguém.' USING ERRCODE = '42501';
    END IF;
    IF public.blocked_between(NEW.gestor_id, NEW.membro_id) THEN
      RAISE EXCEPTION 'Não foi possível convidar este usuário.' USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM public.obra_equipe e WHERE e.gestor_id = NEW.gestor_id) >= 100 THEN
      RAISE EXCEPTION 'Limite de 100 pessoas na equipe.' USING ERRCODE = '54000';
    END IF;
    BEGIN
      v_rl := public.check_rate_limit(NEW.gestor_id::text, 'obra-convite', 20, 60);
    EXCEPTION WHEN OTHERS THEN
      v_rl := jsonb_build_object('allowed', true);
    END;
    IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
      RAISE EXCEPTION 'rate limit: muitos convites seguidos, espere um pouco.' USING ERRCODE = '54000';
    END IF;
    NEW.status := 'convidado';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Gestor pode tirar da equipe ('saiu') ou reconvidar quem recusou/saiu.
    IF NOT (NEW.status = 'saiu'
            OR (NEW.status = 'convidado' AND OLD.status IN ('recusado', 'saiu'))) THEN
      NEW.status := OLD.status;
    ELSIF NEW.status = 'convidado' THEN
      -- Reconvite gera aviso de novo: mesmo teto do convite, e respeita
      -- bloqueio feito DEPOIS do primeiro convite.
      IF public.blocked_between(NEW.gestor_id, NEW.membro_id) THEN
        RAISE EXCEPTION 'Não foi possível convidar este usuário.' USING ERRCODE = '42501';
      END IF;
      BEGIN
        v_rl := public.check_rate_limit(NEW.gestor_id::text, 'obra-convite', 20, 60);
      EXCEPTION WHEN OTHERS THEN
        v_rl := jsonb_build_object('allowed', true);
      END;
      IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
        RAISE EXCEPTION 'rate limit: muitos convites seguidos, espere um pouco.' USING ERRCODE = '54000';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_obra_equipe ON public.obra_equipe;
CREATE TRIGGER trg_protect_obra_equipe
  BEFORE INSERT OR UPDATE ON public.obra_equipe
  FOR EACH ROW EXECUTE FUNCTION public.protect_obra_equipe();

-- 2. Aviso do convite no sininho/push (só pra quem tem conta).
CREATE OR REPLACE FUNCTION public.notify_obra_convite()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome text;
BEGIN
  IF NEW.membro_id IS NULL OR NEW.status <> 'convidado' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'convidado' THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(p.name, ''), 'Um profissional') INTO v_nome
    FROM public.profiles p WHERE p.id = NEW.gestor_id;
  BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, ref_id)
    VALUES (NEW.membro_id, NEW.gestor_id, 'obra_convite', 'Convite pra equipe',
            COALESCE(v_nome, 'Um profissional') || ' te convidou pra equipe de obras dele.',
            NEW.id::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_obra_convite: %', SQLERRM; -- aviso nunca derruba o convite
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_obra_convite ON public.obra_equipe;
CREATE TRIGGER trg_notify_obra_convite
  AFTER INSERT OR UPDATE OF status ON public.obra_equipe
  FOR EACH ROW EXECUTE FUNCTION public.notify_obra_convite();

-- 3. Lançamento do Financeiro / anotação só pode apontar pra obra do DONO.
CREATE OR REPLACE FUNCTION public.check_obra_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid;
BEGIN
  IF NEW.obra_id IS NULL THEN RETURN NEW; END IF;
  v_owner := COALESCE(to_jsonb(NEW) ->> 'painter_id', to_jsonb(NEW) ->> 'user_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.obras o WHERE o.id = NEW.obra_id AND o.owner_id = v_owner) THEN
    RAISE EXCEPTION 'Obra inválida.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_check_obra ON public.jobs;
CREATE TRIGGER trg_jobs_check_obra BEFORE INSERT OR UPDATE OF obra_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.check_obra_link();
DROP TRIGGER IF EXISTS trg_notes_check_obra ON public.notes;
CREATE TRIGGER trg_notes_check_obra BEFORE INSERT OR UPDATE OF obra_id ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.check_obra_link();

-- 4. FUNCIONÁRIO: convites pendentes (sem ver diária nem telefone).
CREATE OR REPLACE FUNCTION public.meus_convites_equipe()
RETURNS TABLE (id uuid, gestor_nome text, gestor_tag text, funcao text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, p.name, COALESCE(p.tag, p.username), e.funcao, e.created_at
    FROM public.obra_equipe e
    JOIN public.profiles p ON p.id = e.gestor_id
   WHERE e.membro_id = auth.uid() AND e.status = 'convidado'
   ORDER BY e.created_at DESC
   LIMIT 20;
$$;

-- 5. FUNCIONÁRIO: aceitar/recusar convite, ou sair da equipe.
CREATE OR REPLACE FUNCTION public.responder_convite_equipe(p_id uuid, p_aceitar boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_gestor uuid; v_nome text;
BEGIN
  UPDATE public.obra_equipe e
     SET status = CASE WHEN p_aceitar THEN 'ativo' ELSE 'recusado' END
   WHERE e.id = p_id AND e.membro_id = auth.uid() AND e.status = 'convidado'
  RETURNING e.gestor_id INTO v_gestor;
  IF v_gestor IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(NULLIF(p.name, ''), 'Um profissional') INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();
  BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, ref_id)
    VALUES (v_gestor, auth.uid(), 'obra_convite_resposta',
            CASE WHEN p_aceitar THEN 'Convite aceito' ELSE 'Convite recusado' END,
            COALESCE(v_nome, 'Um profissional')
              || CASE WHEN p_aceitar THEN ' entrou na sua equipe.' ELSE ' recusou o convite.' END,
            p_id::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'responder_convite_equipe aviso: %', SQLERRM;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.sair_da_equipe(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.obra_equipe e SET status = 'saiu'
   WHERE e.id = p_id AND e.membro_id = auth.uid() AND e.status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Você não está nesta equipe.' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- 6. FUNCIONÁRIO: minha agenda. Devolve só o que ele precisa pra chegar e
--    trabalhar — nunca valor da obra, observações nem diária de ninguém.
CREATE OR REPLACE FUNCTION public.minha_agenda_obras(p_de date, p_ate date)
RETURNS TABLE (
  escala_id uuid, dia date, hora_inicio time, hora_fim time, tarefa text,
  presenca text, obra_nome text, obra_endereco text, gestor_nome text, colegas text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.dia, s.hora_inicio, s.hora_fim, s.tarefa, s.presenca,
         o.nome, o.endereco, g.name,
         (SELECT string_agg(m2.nome, ', ' ORDER BY m2.nome)
            FROM public.obra_escala s2
            JOIN public.obra_equipe m2 ON m2.id = s2.equipe_id
           WHERE s2.obra_id = s.obra_id AND s2.dia = s.dia AND s2.id <> s.id)
    FROM public.obra_escala s
    JOIN public.obra_equipe m ON m.id = s.equipe_id
    JOIN public.obras o ON o.id = s.obra_id
    JOIN public.profiles g ON g.id = o.owner_id
   WHERE m.membro_id = auth.uid()
     AND m.status = 'ativo'
     AND s.dia BETWEEN p_de AND LEAST(p_ate, p_de + 62)
   ORDER BY s.dia, s.hora_inicio NULLS LAST
   LIMIT 200;
$$;

-- 7. FUNCIONÁRIO: confirmar presença (ou desfazer).
CREATE OR REPLACE FUNCTION public.confirmar_presenca_obra(p_escala_id uuid, p_confirmar boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.obra_escala s
     SET presenca = CASE WHEN p_confirmar THEN 'confirmada' ELSE 'pendente' END
   WHERE s.id = p_escala_id
     AND EXISTS (SELECT 1 FROM public.obra_equipe m
                  WHERE m.id = s.equipe_id AND m.membro_id = auth.uid() AND m.status = 'ativo');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala não encontrada.' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- 8. GESTOR: "Enviar escala" — 1 aviso por funcionário com conta (não 1
--    por dia escalado) e devolve os SEM conta pro app abrir o WhatsApp.
CREATE OR REPLACE FUNCTION public.enviar_escala_obras(p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ate date := LEAST(p_ate, p_de + 31);
  v_rl jsonb;
  v_nome text;
  v_app int := 0;
  v_sem jsonb;
  r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501'; END IF;
  BEGIN
    v_rl := public.check_rate_limit(v_uid::text, 'obra-escala', 10, 60);
  EXCEPTION WHEN OTHERS THEN
    v_rl := jsonb_build_object('allowed', true);
  END;
  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'rate limit: espere um pouco pra reenviar a escala.' USING ERRCODE = '54000';
  END IF;
  SELECT COALESCE(NULLIF(p.name, ''), 'Seu gestor') INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  FOR r IN
    SELECT m.membro_id, count(*) AS dias
      FROM public.obra_escala s
      JOIN public.obras o ON o.id = s.obra_id
      JOIN public.obra_equipe m ON m.id = s.equipe_id
     WHERE o.owner_id = v_uid AND m.gestor_id = v_uid AND m.status = 'ativo'
       AND m.membro_id IS NOT NULL AND s.dia BETWEEN p_de AND v_ate
     GROUP BY m.membro_id
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, actor_id, type, title, body, ref_id)
      VALUES (r.membro_id, v_uid, 'obra_escala', 'Escala da semana',
              COALESCE(v_nome, 'Seu gestor') || ' te escalou em ' || r.dias
                || CASE WHEN r.dias = 1 THEN ' dia.' ELSE ' dias.' END
                || ' Veja em Gestão de Obras.',
              to_char(p_de, 'YYYY-MM-DD'));
      v_app := v_app + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enviar_escala aviso: %', SQLERRM;
    END;
  END LOOP;

  UPDATE public.obra_escala s SET notificado_at = now()
    FROM public.obras o
   WHERE o.id = s.obra_id AND o.owner_id = v_uid AND s.dia BETWEEN p_de AND v_ate;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'telefone', x.telefone, 'dias', x.dias)), '[]'::jsonb)
    INTO v_sem
    FROM (
      SELECT m.nome, m.telefone, count(*) AS dias
        FROM public.obra_escala s
        JOIN public.obras o ON o.id = s.obra_id
        JOIN public.obra_equipe m ON m.id = s.equipe_id
       WHERE o.owner_id = v_uid AND m.gestor_id = v_uid AND m.status = 'ativo'
         AND m.membro_id IS NULL AND s.dia BETWEEN p_de AND v_ate
       GROUP BY m.id, m.nome, m.telefone
    ) x;

  RETURN jsonb_build_object('app', v_app, 'sem_conta', v_sem);
END $$;

REVOKE ALL ON FUNCTION public.meus_convites_equipe() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.responder_convite_equipe(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sair_da_equipe(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.minha_agenda_obras(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirmar_presenca_obra(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enviar_escala_obras(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_obra_equipe() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_obra_convite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_obra_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meus_convites_equipe() TO authenticated;
GRANT EXECUTE ON FUNCTION public.responder_convite_equipe(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sair_da_equipe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_agenda_obras(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_presenca_obra(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_escala_obras(date, date) TO authenticated;

-- Conferência: todas as linhas com ok = true.
SELECT 'tabelas com RLS' AS item,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname IN ('obras', 'obra_equipe', 'obra_escala')
           AND c.relrowsecurity) = 3 AS ok
UNION ALL SELECT 'policies das 3 tabelas',
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename IN ('obras', 'obra_equipe', 'obra_escala')) = 3
UNION ALL SELECT 'trigger de proteção da equipe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_obra_equipe')
UNION ALL SELECT 'jobs.categoria e jobs.obra_id',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name IN ('categoria', 'obra_id')) = 2
UNION ALL SELECT 'anon sem EXECUTE na agenda',
       NOT has_function_privilege('anon', 'public.minha_agenda_obras(date, date)', 'EXECUTE')
UNION ALL SELECT 'quotes: só policy de UPDATE do pintor',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'quotes'
                     AND cmd IN ('UPDATE', 'ALL') AND policyname <> 'quotes_update_painter');
