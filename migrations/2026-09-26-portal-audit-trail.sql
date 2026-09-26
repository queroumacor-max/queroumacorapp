-- ============================================================================
-- 2026-09-26 — Trilha de auditoria das edições feitas pelo PORTAL.
--
-- O portal escreve direto no Supabase (supabase-js + RLS is_portal_admin()),
-- sem passar por rota nossa — então nada gravava QUEM mudou O QUÊ no prompt
-- da IA do WhatsApp, no catálogo, nas lojas, nos avisos, na Click Rua etc.
-- (achado da auditoria de release 2026-09-18).
--
-- Solução no banco, pra não depender de cada tela lembrar de logar: um
-- trigger AFTER INSERT/UPDATE/DELETE que grava em `audit_log`:
--   actor_id     = auth.uid() de quem fez (o admin logado no portal)
--   action       = 'portal.<tabela>.<insert|update|delete>'
--   target_id    = id da linha
--   changes      = no UPDATE só as colunas que MUDARAM ({col:{old,new}});
--                  no INSERT/DELETE a linha inteira. Texto longo cortado em
--                  4000 caracteres (o prompt da IA cabe inteiro).
--
-- Só registra escrita feita por USUÁRIO LOGADO (auth.uid() presente). Cron,
-- webhook e rotas com service_role não entram — não são "edição do portal"
-- e inundariam a tabela (o follow-up grava whatsapp_ai_config de hora em
-- hora, o webhook atualiza leads a cada status de entrega).
--
-- posts/comments: só a MODERAÇÃO (admin apagando/mudando status do conteúdo
-- de OUTRA pessoa) — era a lacuna registrada em 2026-09-07 ("apagar post
-- alheio não deixa rastro de quem apagou"). Ação do próprio dono não entra.
--
-- Falha ao auditar NUNCA derruba a escrita (EXCEPTION → WARNING).
-- Idempotente. Tabela ausente é pulada com NOTICE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_cortar(v jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 4000
      THEN to_jsonb(left(v #>> '{}', 4000) || '…')
    ELSE v
  END
$$;

CREATE OR REPLACE FUNCTION public.audit_portal_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_id text;
  k text;
  v_ignorar text[] := ARRAY['updated_at','search_vector'];
BEGIN
  IF v_actor IS NULL THEN RETURN NULL; END IF;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  -- Conteúdo de usuário: só moderação de conteúdo ALHEIO.
  IF TG_TABLE_NAME IN ('posts','comments') THEN
    IF coalesce(v_new ->> 'user_id', v_old ->> 'user_id') = v_actor::text THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE'
       AND (v_new -> 'deleted_at') IS NOT DISTINCT FROM (v_old -> 'deleted_at')
       AND (v_new -> 'status') IS NOT DISTINCT FROM (v_old -> 'status') THEN
      RETURN NULL; -- contadores e afins, não é moderação
    END IF;
    IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN k = ANY (v_ignorar);
      IF (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN
        v_changes := v_changes || jsonb_build_object(
          k, jsonb_build_object('old', public.audit_cortar(v_old -> k),
                                'new', public.audit_cortar(v_new -> k)));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    FOR k IN SELECT jsonb_object_keys(coalesce(v_new, v_old)) LOOP
      CONTINUE WHEN k = ANY (v_ignorar);
      v_changes := v_changes || jsonb_build_object(k, public.audit_cortar(coalesce(v_new, v_old) -> k));
    END LOOP;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, changes)
  VALUES (v_actor, 'portal.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_id, v_changes);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit_portal_change(%): %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.audit_portal_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'whatsapp_ai_config','products','product_variants','stores',
    'click_rua_editions','announcements','price_table_items','leads',
    'posts','comments'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'PULADO % (tabela não existe)', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_portal ON public.%I', t);
    IF t = 'leads' THEN
      -- Importação de planilha cria milhares de linhas de uma vez: só a
      -- edição/exclusão do operador interessa.
      EXECUTE format('CREATE TRIGGER trg_audit_portal AFTER UPDATE OR DELETE ON public.%I '
                     'FOR EACH ROW EXECUTE FUNCTION public.audit_portal_change()', t);
    ELSE
      EXECUTE format('CREATE TRIGGER trg_audit_portal AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                     'FOR EACH ROW EXECUTE FUNCTION public.audit_portal_change()', t);
    END IF;
  END LOOP;
END $$;

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'trigger de auditoria em ' || c.relname AS item, true AS ok
  FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
 WHERE tg.tgname = 'trg_audit_portal'
UNION ALL
SELECT 'função audit_portal_change existe',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_portal_change')
ORDER BY 1;
