-- ════════════════════════════════════════════════════════════════════
-- Gestão de Obras: acesso do CLIENTE (2026-09-25)
-- ════════════════════════════════════════════════════════════════════
-- O cliente da obra ganha uma tela "Minhas Obras", só de LEITURA: status,
-- endereço, equipe (nome + função, nunca telefone/diária) e agenda
-- (dia, horário, tarefa, quem vai). Mesmo padrão de segurança das
-- auditorias: RLS em tudo, função em policy embrulhada em (SELECT …),
-- subquery correlacionada com coluna qualificada, toda SECURITY DEFINER
-- com SET search_path, anon sem acesso, rate limit no vínculo, e-mail
-- confirmado e bloqueio respeitados. O cliente NUNCA lê `obras`/
-- `obra_equipe`/`obra_escala` direto — só por RPC, que devolve o mínimo
-- (sem valor, sem observações do gestor, sem diária de ninguém).
-- Idempotente.

-- 1. Vínculo: obra → cliente (perfil do app). Segue o mesmo precedente de
--    `quotes.client_id` — o gestor vincula direto, sem passo de aceite do
--    cliente (ele já sabe que contratou o serviço; diferente do convite
--    de EQUIPE, que implica obrigação de trabalho e por isso exige aceite).
ALTER TABLE public.obras ADD COLUMN IF NOT EXISTS client_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_obras_client ON public.obras (client_id) WHERE client_id IS NOT NULL;

-- 2. Trava no vínculo (defesa em profundidade — cobre também um PATCH
--    direto via REST, não só o caminho do app): só quem tem e-mail
--    confirmado vincula, nunca vincula gente bloqueada, e tem rate limit.
CREATE OR REPLACE FUNCTION public.protect_obra_cliente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rl jsonb;
BEGIN
  IF public.is_portal_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL OR NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id = NEW.owner_id THEN
    RAISE EXCEPTION 'Você não pode se vincular como cliente da própria obra.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_email_verified() THEN
    RAISE EXCEPTION 'Confirme seu e-mail antes de vincular um cliente.' USING ERRCODE = '42501';
  END IF;
  IF public.blocked_between(NEW.owner_id, NEW.client_id) THEN
    RAISE EXCEPTION 'Não foi possível vincular este cliente.' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_rl := public.check_rate_limit(NEW.owner_id::text, 'obra-cliente-link', 20, 60);
  EXCEPTION WHEN OTHERS THEN
    v_rl := jsonb_build_object('allowed', true);
  END;
  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'rate limit: muitos vínculos seguidos, espere um pouco.' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_obra_cliente ON public.obras;
CREATE TRIGGER trg_protect_obra_cliente
  BEFORE INSERT OR UPDATE OF client_id ON public.obras
  FOR EACH ROW EXECUTE FUNCTION public.protect_obra_cliente();

-- 3. Aviso pro cliente quando a obra é vinculada.
CREATE OR REPLACE FUNCTION public.notify_obra_cliente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome text;
BEGIN
  IF NEW.client_id IS NULL OR NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(p.name, ''), 'Um profissional') INTO v_nome
    FROM public.profiles p WHERE p.id = NEW.owner_id;
  BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, ref_id)
    VALUES (NEW.client_id, NEW.owner_id, 'obra_cliente_vinculo', 'Sua obra no QueroUmaCor',
            COALESCE(v_nome, 'Um profissional') || ' te deu acesso ao andamento da obra "' || NEW.nome || '".',
            NEW.id::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_obra_cliente: %', SQLERRM; -- aviso nunca derruba o vínculo
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_obra_cliente ON public.obras;
CREATE TRIGGER trg_notify_obra_cliente
  AFTER INSERT OR UPDATE OF client_id ON public.obras
  FOR EACH ROW EXECUTE FUNCTION public.notify_obra_cliente();

-- 4. CLIENTE: lista das próprias obras (status, endereço, datas — nunca
--    valor nem observações do gestor).
CREATE OR REPLACE FUNCTION public.minhas_obras_cliente()
RETURNS TABLE (
  obra_id uuid, nome text, status text, endereco text,
  inicio date, fim date, gestor_nome text, gestor_tag text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.nome, o.status, o.endereco, o.inicio, o.fim,
         g.name, COALESCE(g.tag, g.username)
    FROM public.obras o
    JOIN public.profiles g ON g.id = o.owner_id
   WHERE o.client_id = auth.uid()
   ORDER BY o.created_at DESC
   LIMIT 50;
$$;

-- 5. CLIENTE: quem já foi escalado nessa obra (equipe não é "da obra", é
--    do gestor — quem trabalha NESSA obra é definido pela escala). Só
--    nome e função, gente ATIVA, sem duplicar quem tem vários dias.
CREATE OR REPLACE FUNCTION public.obra_equipe_cliente(p_obra_id uuid)
RETURNS TABLE (nome text, funcao text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT m.nome, m.funcao
    FROM public.obra_escala s
    JOIN public.obra_equipe m ON m.id = s.equipe_id
    JOIN public.obras o ON o.id = s.obra_id
   WHERE o.id = p_obra_id
     AND o.client_id = auth.uid()
     AND m.status = 'ativo'
   ORDER BY m.nome
   LIMIT 100;
$$;

-- 6. CLIENTE: agenda da obra — dia, horário, tarefa, presença e quem vai
--    (só nome; nunca telefone nem diária).
CREATE OR REPLACE FUNCTION public.obra_agenda_cliente(p_obra_id uuid, p_de date, p_ate date)
RETURNS TABLE (
  dia date, hora_inicio time, hora_fim time, tarefa text, presenca text, equipe text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.dia, s.hora_inicio, s.hora_fim, s.tarefa, s.presenca,
         string_agg(DISTINCT m.nome, ', ' ORDER BY m.nome)
    FROM public.obra_escala s
    JOIN public.obra_equipe m ON m.id = s.equipe_id
    JOIN public.obras o ON o.id = s.obra_id
   WHERE o.id = p_obra_id
     AND o.client_id = auth.uid()
     AND s.dia BETWEEN p_de AND LEAST(p_ate, p_de + 62)
   GROUP BY s.id, s.dia, s.hora_inicio, s.hora_fim, s.tarefa, s.presenca
   ORDER BY s.dia, s.hora_inicio NULLS LAST
   LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.minhas_obras_cliente() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obra_equipe_cliente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obra_agenda_cliente(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_obra_cliente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_obra_cliente() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minhas_obras_cliente() TO authenticated;
GRANT EXECUTE ON FUNCTION public.obra_equipe_cliente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obra_agenda_cliente(uuid, date, date) TO authenticated;

-- Conferência: todas as linhas com ok = true.
SELECT 'obras.client_id existe' AS item,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'obras' AND column_name = 'client_id') AS ok
UNION ALL SELECT 'trigger de proteção do vínculo',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_obra_cliente')
UNION ALL SELECT 'anon sem EXECUTE nas RPCs do cliente',
       NOT has_function_privilege('anon', 'public.minhas_obras_cliente()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.obra_agenda_cliente(uuid, date, date)', 'EXECUTE');
