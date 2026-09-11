-- ============================================================================
-- AUDITORIA DE SEGURANÇA (2026-09-11) — lado do banco.
--
-- Corrige o que a varredura de fluxo de dados achou nas migrations. Cada
-- bloco é independente e IDEMPOTENTE (rodar de novo não faz mal). Rodar UM
-- bloco por vez no SQL Editor (colar bloco grande de uma vez já mutilou
-- statement antes — ver Wave 26/39 no CLAUDE.md).
--
-- A conferência (só leitura) está no fim de
-- migrations/2026-09-05-conferencia-pendencias.sql: cada item deste arquivo
-- tem uma linha lá que devolve `ok = true` quando o bloco entrou.
--
-- ATENÇÃO: o banco vivo pode diferir dos arquivos deste repo (as migrations
-- são coladas à mão). Os blocos usam CREATE OR REPLACE / DROP IF EXISTS pra
-- valer independente do que está lá.
-- ============================================================================


-- ─── 1. push_device_tokens: UPDATE só do próprio dono ───────────────────────
-- A policy tinha `USING (true)`: qualquer usuário logado podia fazer
-- `update push_device_tokens set user_id = eu` na tabela INTEIRA e depois
-- ler todos os tokens FCM/APNs (o SELECT é por dono). O caso legítimo que
-- ela cobria — aparelho que trocou de conta — passa a ser a RPC do bloco 2.
DROP POLICY IF EXISTS "push_device_tokens owner update" ON public.push_device_tokens;
CREATE POLICY "push_device_tokens owner update" ON public.push_device_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ─── 2. RPC pra reivindicar o token de um aparelho que trocou de conta ─────
-- Quem chama precisa TER o token (segredo que só aquele aparelho conhece);
-- só a linha daquele token muda de dono. O app chama isto quando o upsert
-- por `token` bate na RLS do bloco 1.
CREATE OR REPLACE FUNCTION public.claim_push_device_token(p_token text, p_platform text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 4096 THEN RETURN false; END IF;
  UPDATE public.push_device_tokens
     SET user_id = auth.uid(),
         platform = COALESCE(p_platform, platform),
         last_seen_at = now()
   WHERE token = p_token;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
REVOKE ALL ON FUNCTION public.claim_push_device_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_push_device_token(text, text) TO authenticated;


-- ─── 3. Funções SECURITY DEFINER que eram chamáveis por qualquer usuário ────
-- `GRANT … TO service_role` NÃO tira o EXECUTE que o Postgres/Supabase dá a
-- PUBLIC/anon/authenticated por padrão. Resultado: `sb.rpc('upsert_invoice')`
-- do navegador gravava/sobrescrevia fatura de QUALQUER usuário (e disparava
-- o trigger que estende o PRO); `cleanup_old_audit_events()` apagava a
-- trilha de auditoria; `check_rate_limit(uuid_da_vitima, …)` esgotava o
-- limite de outra pessoa. Só as três funções abaixo do bloco tinham REVOKE.
REVOKE ALL ON FUNCTION public.upsert_invoice(uuid, text, text, text, numeric, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_audit_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_messages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_quotes() FROM PUBLIC, anon, authenticated;
-- Status/uso de OUTRA conta não é dado público: só o próprio (ou service role).
REVOKE ALL ON FUNCTION public.is_pro_active(uuid) FROM PUBLIC, anon;


-- ─── 4. ai_usage_this_month / is_pro_active: só o próprio uid ──────────────
-- Recebiam o uid como parâmetro e nunca comparavam com auth.uid(): o
-- consumo de IA e o status PRO de qualquer conta eram consultáveis. O
-- service role (webhook, rotas de API) continua podendo passar qualquer uid.
CREATE OR REPLACE FUNCTION public.ai_usage_this_month(p_user_id uuid, p_feature text DEFAULT NULL)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(cost_units), 0)::int FROM public.ai_usage
  WHERE user_id = p_user_id
    AND (p_user_id = auth.uid() OR auth.role() = 'service_role')
    AND used_at >= date_trunc('month', now())
    AND (p_feature IS NULL OR feature = p_feature);
$$;

CREATE OR REPLACE FUNCTION public.is_pro_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND (p_user_id = auth.uid() OR auth.role() = 'service_role')
      AND is_pro = true
      AND (
        pro_expires_at IS NULL
        OR pro_expires_at > now()
        OR (pro_grace_until IS NOT NULL AND pro_grace_until > now())
      )
  );
$$;


-- ─── 5. get_feed_v2: o "eu" é auth.uid(), não o parâmetro ──────────────────
-- SECURITY DEFINER com `p_user_id` vindo do cliente: qualquer uid no
-- parâmetro devolvia os posts SALVOS e curtidos daquela pessoa (saved_posts
-- é privada por RLS) e revelava quem ela bloqueou — inclusive pra anon. A
-- assinatura fica igual (o app segue mandando p_user_id); o corpo ignora.
CREATE OR REPLACE FUNCTION public.get_feed_v2(
  p_limit       int          DEFAULT 10,
  p_cursor      timestamptz  DEFAULT NULL,
  p_user_id     uuid         DEFAULT NULL,
  p_following_ids uuid[]     DEFAULT NULL,
  p_role_filter text         DEFAULT NULL
)
RETURNS TABLE (
  post_id          uuid,
  user_id          uuid,
  caption          text,
  media_url        text,
  media_type       text,
  media_width      int,
  media_height     int,
  created_at       timestamptz,
  boosted_until    timestamptz,
  author           jsonb,
  like_count       bigint,
  comment_count    bigint,
  liked_by_me      boolean,
  saved_by_me      boolean,
  top_comments     jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  base_filter AS (
    SELECT p.*
    FROM public.posts p
    WHERE
      (p.status = 'approved' OR p.status IS NULL)
      AND p.deleted_at IS NULL
      AND COALESCE(p.media_type, '') <> 'story'
      AND (p_following_ids IS NULL OR p.user_id = ANY(p_following_ids))
      AND (
        p_role_filter IS NULL
        OR EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = p.user_id AND pr.role = p_role_filter
        )
      )
      AND (
        auth.uid() IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = p.user_id
        )
      )
  ),
  boosted_top AS (
    SELECT *, 1 AS sort_group FROM base_filter
    WHERE p_cursor IS NULL AND boosted_until > now()
    ORDER BY boosted_until DESC
    LIMIT 3
  ),
  regular AS (
    SELECT *, 2 AS sort_group FROM base_filter
    WHERE (p_cursor IS NULL OR created_at < p_cursor)
      AND id NOT IN (SELECT id FROM boosted_top)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  combined AS (
    SELECT * FROM boosted_top
    UNION ALL
    SELECT * FROM regular
  ),
  filtered_posts AS (
    SELECT * FROM combined
    ORDER BY sort_group ASC,
             CASE sort_group WHEN 1 THEN boosted_until END DESC NULLS LAST,
             created_at DESC
    LIMIT p_limit
  ),
  authors AS (
    SELECT pr.id, jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'tag', pr.tag, 'avatar_url', pr.avatar_url,
      'role', pr.role, 'is_pro', pr.is_pro,
      -- Wave 23 fix B1: include verified (Wave 20 / S1) pra badge ✓ no feed.
      'verified', pr.verified,
      'city', pr.city, 'state', pr.state
    ) AS author_json
    FROM public.profiles pr
    WHERE pr.id IN (SELECT user_id FROM filtered_posts)
  ),
  like_counts AS (
    SELECT post_id, count(*)::bigint AS n FROM public.likes
    WHERE post_id IN (SELECT id FROM filtered_posts) GROUP BY post_id
  ),
  my_likes AS (
    SELECT post_id FROM public.likes
    WHERE auth.uid() IS NOT NULL AND user_id = auth.uid()
      AND post_id IN (SELECT id FROM filtered_posts)
  ),
  my_saved AS (
    SELECT post_id FROM public.saved_posts
    WHERE auth.uid() IS NOT NULL AND user_id = auth.uid()
      AND post_id IN (SELECT id FROM filtered_posts)
  ),
  comment_counts AS (
    SELECT post_id, count(*)::bigint AS n FROM public.comments
    WHERE deleted_at IS NULL AND post_id IN (SELECT id FROM filtered_posts)
    GROUP BY post_id
  ),
  ranked_comments AS (
    SELECT
      c.id, c.post_id, c.user_id, c.text, c.created_at,
      row_number() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC) AS rn
    FROM public.comments c
    WHERE c.deleted_at IS NULL AND c.post_id IN (SELECT id FROM filtered_posts)
  ),
  top_comments_per_post AS (
    SELECT
      rc.post_id,
      jsonb_agg(
        jsonb_build_object(
          'id', rc.id, 'user_id', rc.user_id, 'text', rc.text,
          'created_at', rc.created_at,
          'author', (
            SELECT jsonb_build_object('id', pr.id, 'name', pr.name, 'tag', pr.tag, 'avatar_url', pr.avatar_url)
            FROM public.profiles pr WHERE pr.id = rc.user_id
          )
        )
        ORDER BY rc.created_at ASC
      ) FILTER (WHERE rc.rn <= 3) AS comments_json
    FROM ranked_comments rc GROUP BY rc.post_id
  )
  SELECT
    fp.id, fp.user_id, fp.caption, fp.media_url, fp.media_type,
    fp.media_width, fp.media_height, fp.created_at, fp.boosted_until,
    COALESCE(a.author_json, '{}'::jsonb),
    COALESCE(lc.n, 0), COALESCE(cc.n, 0),
    (ml.post_id IS NOT NULL), (ms.post_id IS NOT NULL),
    COALESCE(tcp.comments_json, '[]'::jsonb)
  FROM filtered_posts fp
  LEFT JOIN authors a ON a.id = fp.user_id
  LEFT JOIN like_counts lc ON lc.post_id = fp.id
  LEFT JOIN my_likes ml ON ml.post_id = fp.id
  LEFT JOIN my_saved ms ON ms.post_id = fp.id
  LEFT JOIN comment_counts cc ON cc.post_id = fp.id
  LEFT JOIN top_comments_per_post tcp ON tcp.post_id = fp.id
  ORDER BY
    CASE WHEN fp.boosted_until > now() THEN 1 ELSE 2 END,
    CASE WHEN fp.boosted_until > now() THEN fp.boosted_until END DESC NULLS LAST,
    fp.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) TO authenticated, anon;


-- ─── 6. protect_profile_columns: mais colunas, bypass do service role ──────
-- O trigger protegia só is_pro/portal_access/role/verified. Ficavam
-- livres: `user_type` (com 'admin' no CHECK — e `sync_role_from_user_type`
-- copia user_type → role quando role está vazio: virava admin de verdade),
-- `pro_expires_at`/`pro_grace_until` (PRO eterno), `rating_avg`/
-- `review_count`/contadores (reputação forjada, que ordena a busca).
-- Lê/escreve via jsonb pra NÃO quebrar se alguma dessas colunas não existir
-- no banco vivo. `auth.role() = 'service_role'` é o bypass das rotas de API
-- e do webhook de pagamento (sem ele, o `handle_invoice_paid` não conseguia
-- ligar o PRO).
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new jsonb;
  v_old jsonb;
  v_col text;
  v_reverter text[] := ARRAY[
    'is_pro','portal_access','role','verified','user_type',
    'pro_expires_at','pro_grace_until',
    'rating_avg','review_count','followers_count','following_count','posts_count'
  ];
BEGIN
  IF auth.role() = 'service_role' OR public.is_portal_admin() THEN
    RETURN NEW;
  END IF;
  v_new := to_jsonb(NEW);

  IF TG_OP = 'INSERT' THEN
    IF v_new ? 'is_pro'        THEN v_new := v_new || jsonb_build_object('is_pro', false); END IF;
    IF v_new ? 'portal_access' THEN v_new := v_new || jsonb_build_object('portal_access', false); END IF;
    IF v_new ? 'verified'      THEN v_new := v_new || jsonb_build_object('verified', false); END IF;
    IF v_new ? 'pro_expires_at' THEN v_new := v_new || jsonb_build_object('pro_expires_at', NULL); END IF;
    IF v_new ? 'pro_grace_until' THEN v_new := v_new || jsonb_build_object('pro_grace_until', NULL); END IF;
    IF (v_new ->> 'role') = 'admin'      THEN v_new := v_new || jsonb_build_object('role', 'pintor'); END IF;
    IF (v_new ->> 'user_type') = 'admin' THEN v_new := v_new || jsonb_build_object('user_type', 'pintor'); END IF;
    FOREACH v_col IN ARRAY ARRAY['rating_avg','review_count','followers_count','following_count','posts_count'] LOOP
      IF v_new ? v_col AND (v_new -> v_col) IS DISTINCT FROM 'null'::jsonb THEN
        v_new := v_new || jsonb_build_object(v_col, 0);
      END IF;
    END LOOP;
    RETURN jsonb_populate_record(NEW, v_new);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    FOREACH v_col IN ARRAY v_reverter LOOP
      IF v_old ? v_col AND (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
        v_new := v_new || jsonb_build_object(v_col, v_old -> v_col);
      END IF;
    END LOOP;
    RETURN jsonb_populate_record(NEW, v_new);
  END IF;

  RETURN NEW;
END $$;
-- O trigger em si já existe (Wave 3/20); recriar garante o nome canônico.
DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

-- E o sincronizador nunca promove a admin sozinho.
CREATE OR REPLACE FUNCTION public.sync_role_from_user_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.role IS NULL OR NEW.role = '')
     AND NEW.user_type IS NOT NULL AND NEW.user_type <> '' THEN
    NEW.role := NEW.user_type;
  END IF;
  -- 'admin' só entra por quem já é admin (portal via service role / admin).
  IF NEW.role = 'admin' AND NOT (auth.role() = 'service_role' OR public.is_portal_admin()) THEN
    NEW.role := COALESCE(NULLIF(OLD.role, ''), 'pintor');
  END IF;
  RETURN NEW;
END $$;


-- ─── 7. orders: comprador não marca o próprio pedido como pago ─────────────
-- `orders_update_own` (Wave 27) deixa o dono fazer UPDATE em qualquer
-- coluna: `status='paid'` + `paid_amount` = pedido "pago" no portal e 100
-- pontos pelo trigger `award_order_paid_points`. O dono só pode CANCELAR;
-- valor, itens, dono e campos de pagamento são do webhook/portal.
CREATE OR REPLACE FUNCTION public.protect_order_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new jsonb; v_old jsonb; v_col text;
BEGIN
  IF auth.role() = 'service_role' OR public.is_portal_admin() THEN
    RETURN NEW;
  END IF;
  v_new := to_jsonb(NEW); v_old := to_jsonb(OLD);
  FOREACH v_col IN ARRAY ARRAY['user_id','items','total','paid_amount','paid_at','tx_id','payment_method','gateway'] LOOP
    IF v_old ? v_col AND (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
      v_new := v_new || jsonb_build_object(v_col, v_old -> v_col);
    END IF;
  END LOOP;
  IF (v_new ->> 'status') IS DISTINCT FROM (v_old ->> 'status')
     AND (v_new ->> 'status') NOT IN ('canceled','cancelled') THEN
    v_new := v_new || jsonb_build_object('status', v_old -> 'status');
  END IF;
  RETURN jsonb_populate_record(NEW, v_new);
END $$;
DROP TRIGGER IF EXISTS trg_protect_order_columns ON public.orders;
CREATE TRIGGER trg_protect_order_columns
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_columns();


-- ─── 8. Pontos: sem farm por orçamento próprio ─────────────────────────────
-- (a) 5 pts por pedido de orçamento: exigia só client_id — 20 RPCs com
--     p_painter_id nulo = 100 pts. Agora precisa de pintor (≠ cliente) e no
--     máximo 3 prêmios por cliente por dia.
CREATE OR REPLACE FUNCTION public.award_quote_request_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.client_id IS NOT NULL
     AND NEW.painter_id IS NOT NULL
     AND NEW.painter_id <> NEW.client_id
     AND (SELECT count(*) FROM public.points
           WHERE user_id = NEW.client_id AND source = 'quote_request'
             AND created_at >= now() - interval '1 day') < 3 THEN
    INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
    VALUES (NEW.client_id, 5, 'earned', 'quote_request', NEW.id, now());
  END IF;
  RETURN NEW;
END $$;

-- (b) 15 pts por orçamento concluído: o pintor aprovava e concluía o
--     PRÓPRIO rascunho (client_id nulo) em dois UPDATEs. Só vale com
--     cliente de verdade, diferente do pintor.
CREATE OR REPLACE FUNCTION public.award_quote_completed_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'concluido'
     AND OLD.status IS DISTINCT FROM 'concluido'
     AND OLD.status IN ('aprovado','em_execucao','accepted','completed')
     AND NEW.painter_id IS NOT NULL
     AND NEW.client_id IS NOT NULL
     AND NEW.client_id <> NEW.painter_id
     AND NOT EXISTS (
       SELECT 1 FROM public.points
        WHERE source = 'quote_completed' AND reference_id = NEW.id
     ) THEN
    INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
    VALUES (NEW.painter_id, 15, 'earned', 'quote_completed', NEW.id, now());
  END IF;
  RETURN NEW;
END $$;


-- ─── 9. messages: só se insere em conversa da qual se faz parte ────────────
-- O INSERT checava só `sender_id`; `conversation_id` era livre. Como os ids
-- de conversa são derivados de UUIDs públicos (`uuidA_uuidB`), dava pra
-- injetar mensagem no chat de duas outras pessoas (as duas veem pela regra
-- de "participante estrutural" do SELECT). O portal (admin) e os gatilhos
-- SECURITY DEFINER (auto-resposta) não passam por aqui.
-- Derruba TODA policy de INSERT que exista (permissivas se somam com OR: a
-- antiga, seja qual for o nome no banco vivo, continuaria liberando).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'messages' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.messages', r.policyname);
  END LOOP;
END $$;
CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND (
      conversation_id IS NULL
      OR POSITION(auth.uid()::text IN conversation_id) > 0
      OR public.is_portal_admin()
    )
  );


-- ─── 10. notify_on_message respeita bloqueio ───────────────────────────────
-- Quem foi bloqueado ainda gerava notificação (e push) na conta que o
-- bloqueou, a cada mensagem, sem teto.
CREATE OR REPLACE FUNCTION public.notify_on_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_label text;
  v_preview     text;
BEGIN
  IF NEW.receiver_id IS NULL OR NEW.receiver_id = NEW.sender_id THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.type, 'text') = 'system' THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.blocks b
     WHERE (b.blocker_id = NEW.receiver_id AND b.blocked_id = NEW.sender_id)
        OR (b.blocker_id = NEW.sender_id AND b.blocked_id = NEW.receiver_id)
  ) THEN
    RETURN NEW;
  END IF;

  v_actor_label := public.notif_actor_label(NEW.sender_id);
  v_preview := CASE
    WHEN COALESCE(NEW.type, 'text') <> 'text' THEN 'enviou um anexo'
    WHEN length(COALESCE(NEW.content, '')) > 80
      THEN substring(NEW.content FROM 1 FOR 80) || '…'
    ELSE COALESCE(NEW.content, '')
  END;

  INSERT INTO public.notifications
    (user_id, actor_id, type, title, body, created_at)
  VALUES
    (NEW.receiver_id, NEW.sender_id, 'message',
     'Nova mensagem',
     v_actor_label || ': ' || v_preview,
     now());

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;


-- ─── 11. search_all: escapa `_`, limita p_limit, mantém search_path='' ─────
-- `___` casava qualquer nome de 3 letras; `p_limit` sem teto varria a base.
create or replace function public.search_all(p_query text, p_limit int default 20)
returns table(
  result_type text,
  id text,
  title text,
  snippet text,
  score real
) language sql stable set search_path = '' as $$
  with q as (
    select
      plainto_tsquery('portuguese', p_query) as tsq,
      '%' || replace(replace(replace(left(p_query, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' as ilk
  )
  select 'profile' as result_type, p.id::text, p.name as title,
    ts_headline('portuguese', coalesce(p.bio,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) as snippet,
    greatest(
      ts_rank(p.search_vector, q.tsq),
      case
        when p.name ilike q.ilk or p.tag ilike q.ilk
          or coalesce(p.profession,'') ilike q.ilk then 0.4
        else 0
      end
    ) as score
  from public.profiles p, q
  where p.search_vector @@ q.tsq
     or p.name ilike q.ilk
     or p.tag ilike q.ilk
     or coalesce(p.profession,'') ilike q.ilk
  union all
  select 'post' as result_type, po.id::text, left(coalesce(po.caption,''), 80) as title,
    ts_headline('portuguese', coalesce(po.caption,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) as snippet,
    ts_rank(po.search_vector, q.tsq) as score
  from public.posts po, q
  where po.search_vector @@ q.tsq
    and po.status = 'approved'
  union all
  select 'product' as result_type, pr.id::text, pr.name as title,
    ts_headline('portuguese', coalesce(pr.description,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) as snippet,
    ts_rank(pr.search_vector, q.tsq) as score
  from public.products pr, q
  where pr.search_vector @@ q.tsq
  order by score desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;


-- ─── 12. leads: RLS ─────────────────────────────────────────────────────────
-- A tabela nasceu fora do repo e NENHUM arquivo aqui liga RLS nela. Se
-- estiver desligada, a chave anon (pública, no bundle) lê 61 mil nomes e
-- telefones. Liga e deixa só quem é admin do portal (o portal lê/escreve
-- com a sessão do admin; as rotas de API usam service role, que ignora RLS).
-- Se o banco vivo já tiver policies próprias, elas seguem valendo (OR).
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leads_admin_all" ON public.leads;
CREATE POLICY "leads_admin_all" ON public.leads
  FOR ALL TO authenticated
  USING (public.is_portal_admin()) WITH CHECK (public.is_portal_admin());
