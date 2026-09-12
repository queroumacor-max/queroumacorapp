-- ============================================================================
-- 2026-09-11 — AUDITORIA DE AUTORIZAÇÃO (RLS / RPC / storage / triggers)
-- ============================================================================
-- Fecha os achados CRÍTICOS e ALTOS da auditoria de 2026-09-11. Cada bloco é
-- idempotente (DROP IF EXISTS + CREATE) e independente: pode rodar UM POR VEZ
-- no SQL Editor (o editor corrompe colagem grande — regra do CLAUDE.md).
-- Depois de rodar, conferir com o bloco "CONFERÊNCIA" no fim.
--
-- O QUE MUDA, em uma linha por bloco:
--  1. profiles: SELECT deixa de ser "todo mundo" (anon incluso) e vira "a
--     própria linha OU admin do portal". Quem precisa de OUTRA pessoa lê
--     `profiles_public` (view, só colunas seguras, agora SECURITY DEFINER).
--  2. profiles: UMA trigger canônica (`zz_protect_profile_columns`) protege
--     is_pro / pro_expires_at / pro_grace_until / portal_access / verified /
--     role / user_type='admin' / contadores / email, e a derivação
--     role←user_type nunca produz 'admin' (era o caminho de escalada).
--  3. leads: RLS ligada, só admin do portal (o webhook grava com service_role).
--  4. messages: quem não é admin não insere `type='store'`, não insere em
--     conversa da qual não faz parte, e só altera deleted_at (remetente) ou
--     read_at (destinatário).
--  5. quotes: partes congeladas depois de criadas; cliente não muda preço nem
--     "conclui"; pontos só com cliente ≠ pintor; review só de orçamento
--     concluído e 1 por profissional a cada 30 dias.
--  6. orders: dono não muda status/total/paid_amount (pontos por pedido pago
--     só via webhook/admin).
--  7. posts: dono não desfaz moderação (status), não se impulsiona
--     (boosted_until) nem troca media_hash.
--  8. push_device_tokens: UPDATE só na própria linha; troca de dono via RPC.
--  9. RPCs privilegiadas (upsert_invoice, check_rate_limit, cleanup_*, …)
--     deixam de ser chamáveis por anon/authenticated.
-- 10. get_feed_v2 ignora p_user_id (usa auth.uid()).
-- 11. admin_delete_user: excluir OUTRO admin exige role='admin' do caller.
-- 12. notify_user: tipo em lista fechada + teto por hora.
-- 13. storage: anon/authenticated não LISTAM os buckets posts/art-refs
--     (URL pública continua servindo — só a enumeração some).
-- 14. policies PUBLIC esquecidas em follows/likes/qualifications/courses/
--     announcements caem (as `_auth` continuam).
-- 15. get_conversations sem e-mail; RPC quote_party_contact pro contato das
--     partes de um orçamento.
-- ============================================================================


-- ─── 1. profiles: leitura ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_portal_admin());

-- A view pública passa a ser SECURITY DEFINER (dona = postgres, ignora a RLS
-- da tabela) — é a ÚNICA projeção de outra pessoa que o app lê. Só colunas
-- seguras (sem email/phone/birth_date/address/cart/portal_access…).
-- CREATE OR REPLACE (colunas novas só no FIM) em vez de DROP … CASCADE, que
-- levaria junto qualquer função/view que dependa desta.
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  id, name, avatar_url, bio, tag, role, user_type, profession, specialties,
  city, state, is_pro, verified, rating_avg, review_count,
  service_radius, instagram_url, website_url,
  followers_count, following_count, posts_count,
  created_at,
  business_name, business_logo_url
FROM public.profiles;
ALTER VIEW public.profiles_public SET (security_invoker = false);
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- search_all lia `profiles` direto como INVOKER: com a policy nova só acharia
-- o próprio perfil. Vira DEFINER (mesma projeção segura: id, nome, bio).
CREATE OR REPLACE FUNCTION public.search_all(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE(result_type text, id text, title text, snippet text, score real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (
    SELECT plainto_tsquery('portuguese', p_query) AS tsq,
           '%' || replace(replace(p_query, '\', '\\'), '%', '\%') || '%' AS ilk
  )
  SELECT 'profile' AS result_type, p.id::text, p.name AS title,
    ts_headline('portuguese', coalesce(p.bio,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3') AS snippet,
    greatest(ts_rank(p.search_vector, q.tsq),
      CASE WHEN p.name ILIKE q.ilk OR p.tag ILIKE q.ilk OR coalesce(p.profession,'') ILIKE q.ilk THEN 0.4 ELSE 0 END) AS score
  FROM public.profiles p, q
  WHERE p.search_vector @@ q.tsq OR p.name ILIKE q.ilk OR p.tag ILIKE q.ilk OR coalesce(p.profession,'') ILIKE q.ilk
  UNION ALL
  SELECT 'post', po.id::text, left(coalesce(po.caption,''), 80),
    ts_headline('portuguese', coalesce(po.caption,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'),
    ts_rank(po.search_vector, q.tsq)
  FROM public.posts po, q
  WHERE po.search_vector @@ q.tsq AND po.status = 'approved' AND po.deleted_at IS NULL
  UNION ALL
  SELECT 'product', pr.id::text, pr.name,
    ts_headline('portuguese', coalesce(pr.description,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'),
    ts_rank(pr.search_vector, q.tsq)
  FROM public.products pr, q
  WHERE pr.search_vector @@ q.tsq
  ORDER BY score DESC
  LIMIT p_limit;
$$;
REVOKE EXECUTE ON FUNCTION public.search_all(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_all(text, int) TO authenticated;

-- Contato (telefone/e-mail) das PARTES de um orçamento — só pra quem é parte.
CREATE OR REPLACE FUNCTION public.quote_party_contact(p_quote_id uuid)
RETURNS TABLE (
  id uuid, name text, tag text, phone text, email text, city text, state text,
  business_logo_url text, business_name text, avatar_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.tag, p.phone, p.email, p.city, p.state,
         p.business_logo_url, p.business_name, p.avatar_url
  FROM public.quotes q
  JOIN public.profiles p ON p.id IN (q.client_id, q.painter_id)
  WHERE q.id = p_quote_id
    AND auth.uid() IS NOT NULL
    AND (auth.uid() = q.client_id OR auth.uid() = q.painter_id OR public.is_portal_admin());
$$;
REVOKE EXECUTE ON FUNCTION public.quote_party_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_party_contact(uuid) TO authenticated;

-- get_conversations devolvia o E-MAIL do interlocutor. Sai.
DROP FUNCTION IF EXISTS public.get_conversations();
CREATE FUNCTION public.get_conversations()
RETURNS TABLE (
  conv_id text, other_id uuid, last_msg text, last_msg_time timestamptz,
  last_sender uuid, is3way boolean, name text, avatar_url text, tag text,
  role text, user_type text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  msgs AS (
    SELECT m.content, m.created_at, m.sender_id, m.type,
      COALESCE(m.conversation_id::text,
        LEAST(m.sender_id::text, m.receiver_id::text) || '-' || GREATEST(m.sender_id::text, m.receiver_id::text)) AS ckey,
      CASE WHEN m.sender_id = (SELECT uid FROM me) THEN m.receiver_id ELSE m.sender_id END AS oid
    FROM public.messages m, me
    WHERE (m.sender_id = (SELECT uid FROM me) OR m.receiver_id = (SELECT uid FROM me))
      AND m.deleted_at IS NULL
  ),
  last_msg AS (
    SELECT DISTINCT ON (ckey) ckey, content, created_at, sender_id, oid
    FROM msgs ORDER BY ckey, created_at DESC
  ),
  flags AS (
    SELECT ckey, bool_or(type = 'system' AND content = '__STORE_ADDED__') AS is3way
    FROM msgs GROUP BY ckey
  )
  SELECT l.ckey, l.oid, l.content, l.created_at, l.sender_id,
         COALESCE(f.is3way, false),
         p.name, p.avatar_url, p.tag, p.role, p.user_type
  FROM last_msg l
  LEFT JOIN flags f ON f.ckey = l.ckey
  LEFT JOIN public.profiles p ON p.id = l.oid
  ORDER BY l.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversations() TO authenticated;


-- ─── 2. profiles: trigger canônica de colunas privilegiadas ──────────────────
-- Substitui as TRÊS versões que já existiram (init v1/v2 e 2026-06-09) e a
-- trigger de sincronização role←user_type, que rodava DEPOIS da proteção e
-- transformava `user_type='admin'` em `role='admin'` (escalada confirmada na
-- auditoria). NÃO é SECURITY DEFINER de propósito: dentro de uma função
-- DEFINER `current_user` seria sempre o dono e o bypass valeria pra todos.
-- Bypass legítimo: service_role (rotas admin, webhook do MP), RPCs
-- SECURITY DEFINER do próprio banco (current_user = postgres:
-- redeem_pro_with_points, handle_invoice_paid, handle_new_user, contadores)
-- e admin do portal logado.
DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
DROP TRIGGER IF EXISTS protect_profile_columns ON public.profiles;
DROP TRIGGER IF EXISTS zz_protect_profile_columns ON public.profiles;
DROP TRIGGER IF EXISTS trg_sync_role_from_user_type ON public.profiles;

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  privileged boolean;
BEGIN
  privileged :=
       current_user IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(auth.role(), '') = 'service_role'
    OR public.is_portal_admin();

  -- role ← user_type (era trg_sync_role_from_user_type): só papel comum.
  IF (NEW.role IS NULL OR NEW.role = '')
     AND COALESCE(NEW.user_type, '') NOT IN ('', 'admin') THEN
    NEW.role := NEW.user_type;
  END IF;

  IF privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_pro := false;
    NEW.pro_expires_at := NULL;
    NEW.pro_grace_until := NULL;
    NEW.portal_access := false;
    NEW.verified := false;
    IF NEW.role = 'admin' OR NEW.user_type = 'admin' THEN
      NEW.role := 'cliente';
      NEW.user_type := 'cliente';
    END IF;
    NEW.rating_avg := NULL;
    NEW.review_count := 0;
    NEW.followers_count := 0;
    NEW.following_count := 0;
    NEW.posts_count := 0;
    NEW.ai_logo_gen_count := 0;
    NEW.mp_preapproval_id := NULL;
    NEW.email := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: reverte qualquer mudança nas colunas privilegiadas.
  NEW.is_pro := OLD.is_pro;
  NEW.pro_expires_at := OLD.pro_expires_at;
  NEW.pro_grace_until := OLD.pro_grace_until;
  NEW.portal_access := OLD.portal_access;
  NEW.verified := OLD.verified;
  NEW.role := OLD.role;
  IF NEW.user_type = 'admin' THEN NEW.user_type := OLD.user_type; END IF;
  NEW.rating_avg := OLD.rating_avg;
  NEW.review_count := OLD.review_count;
  NEW.followers_count := OLD.followers_count;
  NEW.following_count := OLD.following_count;
  NEW.posts_count := OLD.posts_count;
  NEW.ai_logo_gen_count := OLD.ai_logo_gen_count;
  NEW.mp_preapproval_id := OLD.mp_preapproval_id;
  NEW.email := OLD.email;
  RETURN NEW;
END $$;

-- 'zz_' pra rodar DEPOIS de qualquer outra BEFORE trigger (sync tag/username).
CREATE TRIGGER zz_protect_profile_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();


-- ─── 3. leads: RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_portal_all ON public.leads;
CREATE POLICY leads_portal_all ON public.leads
  FOR ALL TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());


-- ─── 4. messages ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND receiver_id IS DISTINCT FROM sender_id
    AND (
      public.is_portal_admin()
      OR (
        COALESCE(type, 'text') <> 'store'
        AND (conversation_id IS NULL OR position(auth.uid()::text IN conversation_id) > 0)
      )
    )
  );

-- Quem não é admin só mexe em deleted_at (remetente) e read_at (destinatário).
CREATE OR REPLACE FUNCTION public.messages_guard_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR COALESCE(auth.role(), '') = 'service_role'
     OR public.is_portal_admin() THEN
    RETURN NEW;
  END IF;
  NEW.sender_id := OLD.sender_id;
  NEW.receiver_id := OLD.receiver_id;
  NEW.conversation_id := OLD.conversation_id;
  NEW.content := OLD.content;
  NEW.type := OLD.type;
  NEW.created_at := OLD.created_at;
  IF auth.uid() IS DISTINCT FROM OLD.sender_id THEN NEW.deleted_at := OLD.deleted_at; END IF;
  IF auth.uid() IS DISTINCT FROM OLD.receiver_id THEN NEW.read_at := OLD.read_at; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_messages_guard_update ON public.messages;
CREATE TRIGGER zz_messages_guard_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_guard_update();


-- ─── 5. quotes / reviews / pontos ────────────────────────────────────────────
DROP POLICY IF EXISTS quotes_insert_participants ON public.quotes;
CREATE POLICY quotes_insert_participants ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = client_id AND painter_id IS DISTINCT FROM auth.uid())
    OR (auth.uid() = painter_id AND client_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.quotes_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  privileged boolean;
BEGIN
  privileged :=
       current_user IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(auth.role(), '') = 'service_role'
    OR public.is_portal_admin();
  IF privileged THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.client_id IS NOT NULL AND NEW.client_id = NEW.painter_id THEN
      RAISE EXCEPTION 'orçamento não pode ter cliente e pintor iguais';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: partes congeladas.
  NEW.client_id := OLD.client_id;
  NEW.painter_id := OLD.painter_id;
  NEW.created_at := OLD.created_at;

  -- Cliente (que não é o pintor): só aprova/recusa; não mexe em preço,
  -- escopo, datas nem "conclui" (concluir é do pintor — pontos dependem).
  IF auth.uid() = OLD.client_id AND auth.uid() IS DISTINCT FROM OLD.painter_id THEN
    NEW.price := OLD.price;
    NEW.quote_data := OLD.quote_data;
    NEW.scope_snapshot := OLD.scope_snapshot;
    NEW.title := OLD.title;
    NEW.service_type := OLD.service_type;
    NEW.area_m2 := OLD.area_m2;
    NEW.proposed_date := OLD.proposed_date;
    NEW.sent_at := OLD.sent_at;
    NEW.completed_at := OLD.completed_at;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('aprovado', 'recusado', 'cancelado', 'accepted', 'rejected') THEN
      NEW.status := OLD.status;
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN NEW.approved_by := auth.uid(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_quotes_guard ON public.quotes;
CREATE TRIGGER zz_quotes_guard
  BEFORE INSERT OR UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_guard();

-- Pontos por pedido de orçamento: cliente ≠ pintor e no máximo 3 por dia.
CREATE OR REPLACE FUNCTION public.award_quote_request_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.client_id IS NOT NULL
     AND NEW.painter_id IS DISTINCT FROM NEW.client_id
     AND (SELECT count(*) FROM public.points
           WHERE user_id = NEW.client_id AND source = 'quote_request'
             AND created_at > now() - interval '1 day') < 3 THEN
    INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
    VALUES (NEW.client_id, 5, 'earned', 'quote_request', NEW.id, now());
  END IF;
  RETURN NEW;
END $$;

-- Pontos por conclusão: só orçamento com cliente real (≠ pintor).
CREATE OR REPLACE FUNCTION public.award_quote_completed_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'concluido'
     AND OLD.status IS DISTINCT FROM 'concluido'
     AND OLD.status IN ('aprovado','em_execucao','accepted','completed')
     AND NEW.painter_id IS NOT NULL
     AND NEW.client_id IS NOT NULL
     AND NEW.client_id <> NEW.painter_id
     AND NOT EXISTS (SELECT 1 FROM public.points WHERE source = 'quote_completed' AND reference_id = NEW.id) THEN
    INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
    VALUES (NEW.painter_id, 15, 'earned', 'quote_completed', NEW.id, now());
  END IF;
  RETURN NEW;
END $$;

-- Review: só de orçamento concluído, pintor ≠ avaliador, 1 por profissional
-- a cada 30 dias (contra nota fabricada com orçamento inventado).
CREATE OR REPLACE FUNCTION public.submit_review(
  p_quote_id uuid, p_painter_id uuid, p_rating integer,
  p_comment text DEFAULT NULL, p_criteria jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_owner uuid; v_painter uuid; v_status text; v_dup integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para avaliar'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Nota tem que ser de 1 a 5';
  END IF;
  IF p_quote_id IS NULL THEN RAISE EXCEPTION 'Avaliação precisa de um orçamento'; END IF;
  SELECT client_id, painter_id, status INTO v_owner, v_painter, v_status
    FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF v_owner <> auth.uid() THEN RAISE EXCEPTION 'Você só pode avaliar os próprios orçamentos'; END IF;
  IF v_painter IS NULL OR v_painter = auth.uid() THEN RAISE EXCEPTION 'Orçamento sem profissional avaliável'; END IF;
  IF p_painter_id IS NOT NULL AND p_painter_id <> v_painter THEN
    RAISE EXCEPTION 'Painter informado não bate com o do orçamento';
  END IF;
  IF COALESCE(v_status, '') NOT IN ('concluido', 'completed', 'accepted') THEN
    RAISE EXCEPTION 'Só dá pra avaliar um serviço concluído';
  END IF;
  SELECT COUNT(*) INTO v_dup FROM public.reviews WHERE quote_id = p_quote_id AND reviewer_id = auth.uid();
  IF v_dup > 0 THEN RAISE EXCEPTION 'Você já avaliou este orçamento'; END IF;
  SELECT COUNT(*) INTO v_dup FROM public.reviews r
    JOIN public.quotes q ON q.id = r.quote_id
   WHERE r.reviewer_id = auth.uid() AND q.painter_id = v_painter
     AND r.created_at > now() - interval '30 days';
  IF v_dup > 0 THEN RAISE EXCEPTION 'Você já avaliou este profissional nos últimos 30 dias'; END IF;
  INSERT INTO public.reviews (reviewer_id, quote_id, rating, comment, criteria, created_at)
  VALUES (auth.uid(), p_quote_id, p_rating, p_comment, COALESCE(p_criteria, '[]'::jsonb), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


-- ─── 6. orders ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.orders_guard_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR COALESCE(auth.role(), '') = 'service_role'
     OR public.is_portal_admin() THEN
    RETURN NEW;
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.status := OLD.status;
  NEW.total := OLD.total;
  NEW.paid_amount := OLD.paid_amount;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_orders_guard_update ON public.orders;
CREATE TRIGGER zz_orders_guard_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard_update();

CREATE OR REPLACE FUNCTION public.award_order_paid_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pts integer; v_base numeric;
BEGIN
  -- Só transição feita por webhook/admin (o dono não muda status — trigger
  -- acima —, mas fica a segunda tranca).
  IF NOT (current_user IN ('postgres', 'supabase_admin', 'service_role')
          OR COALESCE(auth.role(), '') = 'service_role'
          OR public.is_portal_admin()) THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.user_id IS NOT NULL THEN
    v_base := LEAST(COALESCE(NEW.total, 0), COALESCE(NEW.paid_amount, NEW.total, 0));
    v_pts := LEAST(100, FLOOR(v_base / 10)::integer);
    IF v_pts > 0
       AND NOT EXISTS (SELECT 1 FROM public.points WHERE source = 'order_paid' AND reference_id = NEW.id) THEN
      INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
      VALUES (NEW.user_id, v_pts, 'earned', 'order_paid', NEW.id, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;


-- ─── 7. posts: dono não desfaz moderação nem se impulsiona ───────────────────
-- As colunas abaixo vêm das Waves 22 (boosted_until) e 29 (media_hash). Ao
-- rodar em 2026-09-12 o bloco 10 estourou 42703 "boosted_until does not
-- exist": a Wave 22 constava como executada e NÃO estava. Garantimos as
-- colunas aqui (no-op se existem) — sem isso a trigger abaixo quebraria TODO
-- UPDATE em posts em runtime, e o bloco 10 não compila.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS boosted_until timestamptz;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS media_hash text;
CREATE INDEX IF NOT EXISTS idx_posts_boosted_active ON public.posts (boosted_until)
  WHERE boosted_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.posts_guard_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR COALESCE(auth.role(), '') = 'service_role'
     OR public.is_portal_admin() THEN
    RETURN NEW;
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.status := OLD.status;
  NEW.boosted_until := OLD.boosted_until;
  NEW.media_hash := OLD.media_hash;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_posts_guard_update ON public.posts;
CREATE TRIGGER zz_posts_guard_update
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_guard_update();


-- ─── 8. push_device_tokens ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "push_device_tokens owner update" ON public.push_device_tokens;
CREATE POLICY "push_device_tokens owner update" ON public.push_device_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Aparelho que trocou de conta: o token muda de dono por RPC, nunca por
-- UPDATE em linha alheia.
CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login'; END IF;
  IF p_token IS NULL OR length(p_token) < 10 OR length(p_token) > 4096 THEN
    RAISE EXCEPTION 'token inválido';
  END IF;
  DELETE FROM public.push_device_tokens WHERE token = p_token AND user_id <> auth.uid();
  INSERT INTO public.push_device_tokens (user_id, token, platform, last_seen_at)
  VALUES (auth.uid(), p_token, COALESCE(p_platform, 'unknown'), now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now();
END $$;
REVOKE EXECUTE ON FUNCTION public.register_push_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;


-- ─── 9. RPCs privilegiadas fora do alcance de anon/authenticated ─────────────
-- Supabase concede EXECUTE a anon/authenticated por DEFAULT PRIVILEGES; um
-- GRANT só pra service_role NÃO tira isso. Varre todas as overloads pelo nome.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'upsert_invoice', 'check_rate_limit', 'cleanup_rate_limits',
         'cleanup_old_notifications', 'cleanup_old_audit_events',
         'cleanup_old_messages', 'cleanup_old_quotes', 'cleanup_soft_deleted',
         'cleanup_old_audit_log', 'run_whatsapp_followup', 'notif_actor_label',
         'is_pro_active', 'ai_usage_this_month'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
-- `ai_usage_this_month`/`is_pro_active` são lidas pelo app pelo PRÓPRIO usuário
-- (billing.ts) — devolvidas a authenticated, mas só pra si mesmo:
CREATE OR REPLACE FUNCTION public.ai_usage_this_month(p_user_id uuid, p_feature text DEFAULT NULL)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(cost_units), 0)::int
    FROM public.ai_usage
   WHERE user_id = p_user_id
     AND (auth.uid() = p_user_id OR COALESCE(auth.role(), '') = 'service_role' OR public.is_portal_admin())
     AND used_at >= date_trunc('month', now())
     AND (p_feature IS NULL OR feature = p_feature);
$$;
GRANT EXECUTE ON FUNCTION public.ai_usage_this_month(uuid, text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.is_pro_active(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT p.is_pro
           AND (p.pro_expires_at IS NULL OR p.pro_expires_at > now()
                OR (p.pro_grace_until IS NOT NULL AND p.pro_grace_until > now()))
      FROM public.profiles p
     WHERE p.id = p_user_id
       AND (auth.uid() = p_user_id OR COALESCE(auth.role(), '') = 'service_role' OR public.is_portal_admin())
  ), false);
$$;
GRANT EXECUTE ON FUNCTION public.is_pro_active(uuid) TO authenticated, service_role;


-- ─── 10. get_feed_v2: identidade é auth.uid() ────────────────────────────────
-- Depende das colunas garantidas no bloco 7 (rodar o 7 antes). DROP antes do
-- CREATE: se a versão viva for anterior à Wave 22, o RETURNS TABLE é outro e
-- CREATE OR REPLACE recusa ("cannot change return type").
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS boosted_until timestamptz;
DROP FUNCTION IF EXISTS public.get_feed_v2(int, timestamptz, uuid, uuid[], text);
CREATE FUNCTION public.get_feed_v2(
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
  -- p_user_id é IGNORADO: quem decide liked_by_me/saved_by_me/bloqueios é
  -- auth.uid(). Antes qualquer um passava o uuid de outra pessoa e lia os
  -- salvos/curtidas/bloqueios dela (auditoria 2026-09-11).
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
GRANT EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) FROM anon;


-- ─── 11. admin_delete_user: excluir OUTRO admin exige role='admin' ───────────
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid, p_force_admin boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target jsonb; v_caller_row jsonb;
  v_had_auth boolean := false; v_had_profile boolean := false;
  v_target_priv boolean;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Faça login para excluir contas'; END IF;
  IF NOT public.is_portal_admin() THEN RAISE EXCEPTION 'não autorizado (precisa de acesso ao portal)'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'userId obrigatório'; END IF;
  IF p_user_id = v_caller THEN RAISE EXCEPTION 'você não pode excluir a própria conta por aqui'; END IF;

  SELECT to_jsonb(p) INTO v_target FROM public.profiles p WHERE p.id = p_user_id;
  SELECT to_jsonb(p) INTO v_caller_row FROM public.profiles p WHERE p.id = v_caller;
  v_target_priv := v_target IS NOT NULL AND (
       COALESCE((v_target->>'portal_access')::boolean, false)
    OR COALESCE(v_target->>'role', '') = 'admin'
    OR COALESCE((v_target->>'is_admin')::boolean, false));

  IF v_target_priv THEN
    IF NOT COALESCE(p_force_admin, false) THEN
      RAISE EXCEPTION 'este perfil tem acesso admin/portal — confirme a exclusão de admin no portal';
    END IF;
    -- Operador promovido (portal_access) não exclui outro admin: só role='admin'.
    IF COALESCE(v_caller_row->>'role', '') <> 'admin' THEN
      RAISE EXCEPTION 'só um administrador (role=admin) pode excluir outra conta admin/portal';
    END IF;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, changes)
  VALUES (v_caller, 'admin.user.delete_user', 'profiles', p_user_id::text,
    jsonb_build_object('deleted', true, 'via', 'rpc admin_delete_user',
      'forced_admin', COALESCE(p_force_admin, false),
      'target_name', v_target->>'name', 'target_tag', v_target->>'tag'));

  DELETE FROM auth.users WHERE id = p_user_id;
  v_had_auth := FOUND;
  DELETE FROM public.profiles WHERE id = p_user_id;
  v_had_profile := FOUND;
  IF NOT v_had_auth AND NOT v_had_profile AND v_target IS NULL THEN
    RAISE EXCEPTION 'usuário não encontrado (id %)', p_user_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'deleted', p_user_id,
    'auth_deleted', v_had_auth, 'profile_deleted', v_had_auth OR v_had_profile);
END $$;


-- ─── 12. notify_user: tipo fechado + teto por hora ───────────────────────────
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id uuid, p_type text, p_title text, p_body text, p_ref_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_caller uuid; v_ok boolean; v_type text; v_n integer;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Faça login pra notificar'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_caller THEN RETURN NULL; END IF;
  v_type := COALESCE(NULLIF(TRIM(p_type), ''), 'info');
  IF v_type NOT IN ('info', 'quote_request', 'quote', 'message', 'follow', 'like', 'comment') THEN
    RAISE EXCEPTION 'tipo de notificação inválido';
  END IF;
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE actor_id = v_caller AND created_at > now() - interval '1 hour';
  IF v_n >= 20 THEN RAISE EXCEPTION 'muitas notificações na última hora'; END IF;
  SELECT (
    EXISTS(SELECT 1 FROM public.quotes
       WHERE (client_id = v_caller AND painter_id = p_user_id)
          OR (painter_id = v_caller AND client_id = p_user_id))
    OR EXISTS(SELECT 1 FROM public.messages
       WHERE sender_id = p_user_id AND receiver_id = v_caller)
    OR public.is_portal_admin()
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Sem relação com o destinatário (precisa quote ou conversa iniciada por ele)';
  END IF;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, ref_id, created_at)
  VALUES (p_user_id, v_caller, v_type, COALESCE(p_title, ''), COALESCE(p_body, ''), p_ref_id, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


-- ─── 13. storage: sem LISTAGEM pública dos buckets posts / art-refs ──────────
-- A URL /object/public/… continua servindo (bucket público não consulta a
-- policy de SELECT). O que some é `list('<uuid>/chat/')` por qualquer um.
DROP POLICY IF EXISTS "Public read posts bucket" ON storage.objects;
DROP POLICY IF EXISTS "posts public read" ON storage.objects;
DROP POLICY IF EXISTS "posts owner list" ON storage.objects;
CREATE POLICY "posts owner list" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'posts' AND (split_part(name, '/', 1) = auth.uid()::text OR public.is_portal_admin()));
DROP POLICY IF EXISTS "art-refs public read" ON storage.objects;
DROP POLICY IF EXISTS "art-refs owner list" ON storage.objects;
CREATE POLICY "art-refs owner list" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'art-refs' AND (split_part(name, '/', 1) = auth.uid()::text OR public.is_portal_admin()));


-- ─── 14. policies PUBLIC esquecidas (as `_auth` continuam valendo) ───────────
DROP POLICY IF EXISTS "Follows are viewable by everyone" ON public.follows;
DROP POLICY IF EXISTS "Likes are viewable by everyone" ON public.likes;
DROP POLICY IF EXISTS "Qualifications viewable by everyone" ON public.qualifications;
DROP POLICY IF EXISTS "Courses viewable by everyone" ON public.courses;
DROP POLICY IF EXISTS "Announcements viewable by everyone" ON public.announcements;
-- soft-delete (Wave 8) recriou o SELECT de messages sem `TO authenticated`:
DROP POLICY IF EXISTS "Messages select active" ON public.messages;


-- ─── 15. referrals: status/bônus são do banco, não do cliente ────────────────
CREATE OR REPLACE FUNCTION public.referrals_guard_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR COALESCE(auth.role(), '') = 'service_role'
     OR public.is_portal_admin() THEN
    RETURN NEW;
  END IF;
  NEW.status := 'completed';
  NEW.bonus_points := 10;
  NEW.quote_id := NULL;
  NEW.created_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aa_referrals_guard_insert ON public.referrals;
CREATE TRIGGER aa_referrals_guard_insert
  BEFORE INSERT ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.referrals_guard_insert();
-- Um indicado só pode ter UM indicador. Se já houver duplicata histórica o
-- índice não é criado — a linha de conferência avisa.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS referrals_one_per_referred ON public.referrals(referred_id);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'referrals: há indicados duplicados — limpar antes de criar referrals_one_per_referred';
END $$;


-- ═══════════════════════════════ CONFERÊNCIA ════════════════════════════════
-- Só lê. `ok` = true em todas = auditoria aplicada.
SELECT 'profiles: SELECT só própria linha/admin' AS item,
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='Profiles are viewable by everyone')
       AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_select_own_or_admin') AS ok
UNION ALL SELECT 'profiles_public é SECURITY DEFINER',
       NOT COALESCE((SELECT 'security_invoker=true' = ANY(c.reloptions) FROM pg_class c WHERE c.relname='profiles_public'), false)
UNION ALL SELECT 'trigger canônica zz_protect_profile_columns',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND tgname='zz_protect_profile_columns')
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND tgname IN ('trg_protect_profile_columns','protect_profile_columns','trg_sync_role_from_user_type'))
UNION ALL SELECT 'leads com RLS + policy admin',
       (SELECT relrowsecurity FROM pg_class WHERE oid='public.leads'::regclass)
       AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename='leads' AND policyname='leads_portal_all')
UNION ALL SELECT 'messages: guard de UPDATE',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass AND tgname='zz_messages_guard_update')
UNION ALL SELECT 'quotes: guard',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.quotes'::regclass AND tgname='zz_quotes_guard')
UNION ALL SELECT 'orders: guard',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname='zz_orders_guard_update')
UNION ALL SELECT 'posts: guard',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.posts'::regclass AND tgname='zz_posts_guard_update')
UNION ALL SELECT 'upsert_invoice fora de anon/authenticated',
       NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='upsert_invoice'
                      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
UNION ALL SELECT 'check_rate_limit fora de anon/authenticated',
       NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='check_rate_limit'
                      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
UNION ALL SELECT 'get_feed_v2 usa auth.uid()',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_feed_v2' AND prosrc LIKE '%auth.uid() IS NULL%')
UNION ALL SELECT 'storage posts sem listagem pública',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('Public read posts bucket','posts public read'))
UNION ALL SELECT 'referrals: 1 indicador por indicado',
       EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='referrals' AND indexname='referrals_one_per_referred')
UNION ALL SELECT 'quote_party_contact existe',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='quote_party_contact')
UNION ALL SELECT 'posts.boosted_until e posts.media_hash existem (Waves 22/29)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='posts'
           AND column_name IN ('boosted_until','media_hash')) = 2;
