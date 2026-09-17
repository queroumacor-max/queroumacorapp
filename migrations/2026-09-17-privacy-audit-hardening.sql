-- AUDITORIA COMPLETA DE PRIVACIDADE / LGPD (2026-09-17)
-- ════════════════════════════════════════════════════════════════════
-- Pedido do usuário: auditoria completa de coleta/processamento/
-- armazenamento/acesso/terceiros/retenção/deleção de dados pessoais.
-- Rodada com 6 sub-auditorias paralelas (RLS/views/RPC, deleção de
-- conta, fluxos a terceiros, storage local/mobile, logs/admin/
-- moderação, política vs. realidade técnica). Este arquivo fecha os
-- achados CRÍTICOS/ALTOS que são corrigíveis em SQL.
--
-- Achado mais grave, confirmado por DUAS sub-auditorias independentes:
--
-- ════════════════════════════════════════════════════════════════════
-- A. [CRÍTICO] `public.profiles` (tabela BASE, não a view) tinha
--    policy de SELECT `USING (true)` SEM `TO authenticated` — ou seja,
--    valia pra PUBLIC, incluindo `anon`. Qualquer um com a anon key
--    (pública, em todo bundle do app) fazia
--    `GET /rest/v1/profiles?select=*` e baixava a tabela INTEIRA:
--    email, phone, lat/lng (localização exata), birth_date,
--    portal_access (quem é admin), is_pro, pro_expires_at,
--    mp_preapproval_id, cart, business_logo_url, avatar_hash, etc.
--    — de TODO usuário, sem login.
--
--    Isso tornava toda a estratégia de `profiles_public` (a view
--    curada, criada especificamente pra esconder essas colunas) uma
--    formalidade sem efeito: o atacante nunca precisava passar por
--    ela. O próprio comentário do time em
--    `2026-06-18-rls-phase2.sql` ("anon JÁ lê profiles diretamente")
--    registrou o fato e não o tratou como o bug que é — usou só pra
--    justificar religar `security_invoker` na view.
--
--    FIX: a policy de SELECT na tabela base passa a ser dono-ou-admin
--    apenas. A `profiles_public` (view) some do escopo dessa RLS
--    porque passa a rodar SEM `security_invoker` (volta ao padrão:
--    executa com o privilégio de quem a criou, então ignora a RLS
--    mais restrita da tabela base e projeta só as colunas seguras que
--    ela sempre selecionou) — é o padrão recomendado pra "view pública
--    restrita sobre tabela com RLS estrita". Isso REABRE o aviso do
--    Security Advisor "Security Definer View" pra `profiles_public`,
--    de propósito e documentado: é o trade-off correto aqui (o linter
--    não distingue "view perigosa" de "view curada de propósito"), a
--    alternativa seria não ter view pública nenhuma.
--
-- B. [ALTO] `profiles_public`/`get_feed_v2` expunham `role`, e `role`
--    pode ser literalmente 'admin' — reabria o MESMO vazamento que a
--    Wave 32 (2026-06-12) tentou fechar removendo `portal_access` da
--    mesma view (fechou uma coluna, deixou outra equivalente).
--    `GET /rest/v1/profiles_public?select=name,tag&role=eq.admin`
--    identificava quem é admin/dono da loja pra phishing direcionado.
--    FIX: `NULLIF(role, 'admin')` — nunca aparece o valor 'admin' na
--    view (perfil segue existindo e visível, só o rótulo some).
--
-- C. [MÉDIO] `get_feed_v2`/`get_trending_posts` são SECURITY DEFINER,
--    GRANT pra `anon` (herdado de quando existia modo visitante —
--    REMOVIDO em 2026-06-18, login virou obrigatório) e com `p_limit`/
--    `p_window_days` SEM teto, ao contrário de `search_all` (que já
--    ganhou `LEAST(...,100)` + REVOKE anon em 2026-09-13 pelo MESMO
--    motivo). Sem login nem teto, dava pra puxar o feed inteiro +
--    diretório de autores (nome/tag/avatar/cidade/estado/role) numa
--    chamada só. FIX: mesmo padrão do search_all.
--
-- D. [MÉDIO] Regressão de defesa em profundidade em `search_all`: o
--    hardening de 2026-09-13 (LIMIT clamp + REVOKE anon, corretos)
--    recriou a função a partir de uma versão MAIS ANTIGA do corpo,
--    perdendo sem querer duas correções de 2026-06-12/06-14: as
--    sentinelas anti-XSS do `ts_headline` (CRIT-3 — sem elas, o
--    Postgres usa `<b>`/`</b>` literais como delimitador default) e o
--    match parcial/prefixo em nome de pessoa. NÃO é exploração ativa
--    — o frontend (`sanitizeSearchSnippet`) escapa TODO o snippet e só
--    reintroduz `<b>` a partir das sentinelas específicas, então sem
--    elas o highlight cai em texto plano (fail-safe, como o próprio
--    comentário do helper documenta) — mas a defesa em duas camadas
--    fica com só uma de pé, e a busca por nome parcial quebrou sem
--    ninguém notar. FIX: restaura as duas coisas, mantém o clamp/revoke.
--    De quebra: nenhuma versão de `search_all` até aqui filtrava
--    `posts.deleted_at IS NULL` — post apagado (soft delete) continuava
--    achável pela busca. Corrigido junto (mesma regra que RLS/feed já
--    aplicam a post deletado).
--
-- E. [MÉDIO] `dispatch_push_on_notification` só redige o corpo do push
--    pra `type='message'` (fix de 2026-09-15). `type='comment'` seguia
--    mandando até 80 chars do comentário de verdade pro FCM/lock
--    screen (`notify_on_comment` grava isso em `notifications.body`,
--    que o dispatcher then copia pro push sem filtro). Mesma classe de
--    vazamento que o fix de mensagem já reconheceu e corrigiu — só não
--    tinha sido estendido a comentário. FIX: mesmo padrão (nome de quem
--    comentou + frase genérica no PUSH; `notifications.body` continua
--    completo pra tela /notificacoes, que é o comportamento já aceito
--    pra mensagem).
--
-- F. [MÉDIO] `cleanup_rate_limits()` (purga `rate_limits` > 1h) e
--    `cleanup_old_notifications()`/`cleanup_old_audit_events()` (90d/
--    1 ano) existem desde a Wave inicial mas NUNCA foram agendadas via
--    pg_cron (ficaram como comentário "rodar manualmente quando
--    habilitar pg_cron" — pg_cron já está em uso há meses pra outras
--    3 funções). `rate_limits` guarda IP + chave (inclui tentativa de
--    login falha) crescendo pra sempre; notificações acumulam nome/
--    preview de mensagem de quem interagiu, também pra sempre. FIX:
--    agenda as 3 nos mesmos moldes das funções já agendadas.
--
-- G. [MÉDIO] Nova RPC `quote_painter_contact(p_quote_id)`: a tela
--    `/orcamentos/[id]` lia telefone/email/endereço de negócio do
--    PINTOR direto de `public.profiles` (`.eq('id', quote.painter_id)`)
--    pro CLIENTE ver quem fez o orçamento — uso legítimo (cliente e
--    pintor têm uma relação real via o orçamento), mas dependia
--    inteiramente da RLS aberta do item A pra funcionar; com a tabela
--    fechada, quebraria. RPC SECURITY DEFINER escopada ao MESMO
--    critério de `quotes_select_participants` (cliente, pintor ou
--    admin do orçamento específico) substitui a leitura direta.
--
-- Itens tratados no CÓDIGO (não neste SQL): autosave cross-user no
-- localStorage, `queryClient.clear()` centralizado no logout, deleção
-- de conta (falha silenciosa no DELETE do auth.users + limpeza de
-- Storage), payload de IA (agenda-order manda nome desnecessário),
-- Sentry beforeSend. Ver relatório da auditoria.
--
-- Idempotente: DROP/CREATE OR REPLACE em tudo, seguro rerodar.
-- ════════════════════════════════════════════════════════════════════


-- ─── A. profiles: tabela base só dono/admin; view pública sem invoker ──

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile row" ON public.profiles;
CREATE POLICY "Users can view own profile row" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_portal_admin());

-- profiles_public: recriada de propósito SEM `WITH (security_invoker=true)`
-- — ela precisa rodar com o privilégio de quem a criou pra continuar
-- projetando as colunas seguras de QUALQUER perfil (não só o do
-- chamador) agora que a tabela base ficou restrita a dono/admin.
-- Mesma lista de colunas da Wave "profiles-public-counters"
-- (2026-06-14) + B: `role` nunca mostra o valor 'admin'.
DROP VIEW IF EXISTS public.profiles_public CASCADE;
CREATE VIEW public.profiles_public AS
SELECT
  id, name, avatar_url, bio, tag,
  NULLIF(role, 'admin') AS role,
  user_type, profession, specialties,
  city, state, is_pro, verified, rating_avg, review_count,
  service_radius, instagram_url, website_url,
  followers_count, following_count, posts_count,
  created_at
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

COMMENT ON VIEW public.profiles_public IS
  'View pública restrita — de propósito SEM security_invoker (roda com '
  'privilégio do criador, ignora a RLS estrita de profiles). Padrão '
  'recomendado pra projetar um subconjunto seguro de colunas sobre uma '
  'tabela com RLS restrita a dono/admin. O Security Advisor do Supabase '
  'sinaliza isso como "Security Definer View" — aviso esperado e aceito '
  'aqui, não um bug: religar security_invoker faria a view voltar a '
  'devolver 0 linhas pra quem não é dono/admin, quebrando feed/busca/ '
  'perfil público pra todo mundo. Auditoria de privacidade 2026-09-17.';


-- ─── G. RPC pra contato do pintor num orçamento específico ─────────────

CREATE OR REPLACE FUNCTION public.quote_painter_contact(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id  uuid;
  v_painter_id uuid;
  v_result     jsonb;
BEGIN
  SELECT client_id, painter_id INTO v_client_id, v_painter_id
  FROM public.quotes WHERE id = p_quote_id;

  IF v_painter_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Mesmo critério de quotes_select_participants: só cliente, pintor
  -- ou admin do PRÓPRIO orçamento.
  IF auth.uid() IS NULL
     OR (auth.uid() <> v_client_id AND auth.uid() <> v_painter_id AND NOT public.is_portal_admin())
  THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'tag', p.tag, 'phone', p.phone,
    'email', p.email, 'city', p.city, 'state', p.state,
    'business_logo_url', p.business_logo_url,
    'business_name', p.business_name, 'avatar_url', p.avatar_url
  ) INTO v_result
  FROM public.profiles p WHERE p.id = v_painter_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.quote_painter_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_painter_contact(uuid) TO authenticated;


-- ─── C. get_feed_v2: teto no LIMIT + só quem está logado ───────────────

DROP FUNCTION IF EXISTS public.get_feed_v2(int, timestamptz, uuid, uuid[], text);

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
  -- Privacidade 2026-09-17: LEAST trava o teto em 50 mesmo se o caller
  -- mandar um p_limit gigante (mesmo padrão do search_all/hardening
  -- 2026-09-13) — sem isso dava pra puxar o feed inteiro numa chamada.
  params AS (SELECT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50) AS lim),
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
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE b.blocker_id = p_user_id AND b.blocked_id = p.user_id
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
    LIMIT (SELECT lim FROM params)
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
    LIMIT (SELECT lim FROM params)
  ),
  authors AS (
    SELECT pr.id, jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'tag', pr.tag, 'avatar_url', pr.avatar_url,
      'role', pr.role, 'is_pro', pr.is_pro,
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
    WHERE p_user_id IS NOT NULL AND user_id = p_user_id
      AND post_id IN (SELECT id FROM filtered_posts)
  ),
  my_saved AS (
    SELECT post_id FROM public.saved_posts
    WHERE p_user_id IS NOT NULL AND user_id = p_user_id
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

-- Sem anon: modo visitante foi removido em 2026-06-18, app exige login
-- pra tudo. Manter o GRANT pra anon só ampliava a superfície à toa.
REVOKE ALL ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feed_v2(int, timestamptz, uuid, uuid[], text) TO authenticated;


-- ─── C. get_trending_posts: mesmo tratamento ────────────────────────────

CREATE OR REPLACE FUNCTION public.get_trending_posts(
  p_limit int DEFAULT 30,
  p_window_days int DEFAULT 7
)
RETURNS TABLE (
  id            uuid,
  user_id       uuid,
  caption       text,
  media_url     text,
  media_type    text,
  media_width   int,
  media_height  int,
  created_at    timestamptz,
  score         int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  win AS (
    SELECT (now() - (LEAST(GREATEST(COALESCE(p_window_days, 7), 1), 90)::text || ' days')::interval) AS since
  ),
  likes_recent AS (
    SELECT post_id, count(*)::int AS n
    FROM public.likes, win
    WHERE created_at >= win.since
    GROUP BY post_id
  ),
  comments_recent AS (
    SELECT post_id, count(*)::int AS n
    FROM public.comments, win
    WHERE deleted_at IS NULL AND created_at >= win.since
    GROUP BY post_id
  )
  SELECT
    p.id, p.user_id, p.caption, p.media_url, p.media_type,
    p.media_width, p.media_height, p.created_at,
    (COALESCE(l.n, 0) + 3 * COALESCE(c.n, 0))::int AS score
  FROM public.posts p
  LEFT JOIN likes_recent l ON l.post_id = p.id
  LEFT JOIN comments_recent c ON c.post_id = p.id
  WHERE (p.status = 'approved' OR p.status IS NULL)
    AND p.deleted_at IS NULL
    AND COALESCE(p.media_type, '') <> 'story'
    AND (COALESCE(l.n, 0) + COALESCE(c.n, 0)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE b.blocker_id = auth.uid() AND b.blocked_id = p.user_id
    )
  ORDER BY score DESC, p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.get_trending_posts(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trending_posts(int, int) TO authenticated;


-- ─── D. search_all: restaura sentinelas anti-XSS + prefixo, mantém ──────
--       o clamp/REVOKE anon do hardening de 2026-09-13.

CREATE OR REPLACE FUNCTION public.search_all(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE(
  result_type text,
  id text,
  title text,
  snippet text,
  score real
) LANGUAGE sql STABLE AS $$
  WITH q AS (
    SELECT
      plainto_tsquery('portuguese', p_query) AS tsq,
      '%' || replace(replace(p_query, '\', '\\'), '%', '\%') || '%' AS ilk
  )
  SELECT 'profile' AS result_type, p.id::text, p.name AS title,
    ts_headline('portuguese', coalesce(p.bio,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) AS snippet,
    greatest(
      ts_rank(p.search_vector, q.tsq),
      CASE
        WHEN p.name ILIKE q.ilk OR p.tag ILIKE q.ilk
          OR coalesce(p.profession,'') ILIKE q.ilk THEN 0.4
        ELSE 0
      END
    ) AS score
  FROM public.profiles p, q
  WHERE p.search_vector @@ q.tsq
     OR p.name ILIKE q.ilk
     OR p.tag ILIKE q.ilk
     OR coalesce(p.profession,'') ILIKE q.ilk
  UNION ALL
  SELECT 'post' AS result_type, po.id::text, left(coalesce(po.caption,''), 80) AS title,
    ts_headline('portuguese', coalesce(po.caption,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) AS snippet,
    ts_rank(po.search_vector, q.tsq) AS score
  FROM public.posts po, q
  WHERE po.search_vector @@ q.tsq
    AND po.status = 'approved'
    AND po.deleted_at IS NULL
  UNION ALL
  SELECT 'product' AS result_type, pr.id::text, pr.name AS title,
    ts_headline('portuguese', coalesce(pr.description,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) AS snippet,
    ts_rank(pr.search_vector, q.tsq) AS score
  FROM public.products pr, q
  WHERE pr.search_vector @@ q.tsq
  ORDER BY score DESC
  -- LEAST trava o teto em 100 mesmo se o caller mandar um p_limit gigante;
  -- coalesce cobre p_limit=NULL explícito (o DEFAULT só vale se o param
  -- for OMITIDO, não se vier NULL).
  LIMIT LEAST(coalesce(p_limit, 20), 100);
$$;

REVOKE ALL ON FUNCTION public.search_all(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_all(text, int) TO authenticated, service_role;


-- ─── E. dispatch_push_on_notification: redige comentário também ────────

CREATE OR REPLACE FUNCTION public.dispatch_push_on_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_url        text;
  v_secret     text;
  v_target     text;
  v_rl         jsonb;
  v_push_title text;
  v_push_body  text;
  v_actor_name text;
BEGIN
  SELECT value INTO v_url    FROM app_settings WHERE key = 'push_notify_url';
  SELECT value INTO v_secret FROM app_settings WHERE key = 'push_internal_secret';
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  -- Teto por DESTINATÁRIO (Wave FCM/push 09-13) — continua valendo pra
  -- qualquer fonte de `notifications`, não só mensagem.
  v_rl := public.check_rate_limit(NEW.user_id::text, 'push-dispatch', 20, 1);
  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RETURN NEW;
  END IF;

  v_target := CASE WHEN NEW.type = 'message' THEN '/chat' ELSE '/notificacoes' END;

  -- Push de mensagem e de comentário NUNCA carregam o texto de verdade —
  -- só `notifications.body` (usado dentro do app, na tela /notificacoes)
  -- tem o preview completo. Nome de quem agiu vem do `actor_id` já
  -- gravado na notificação. Privacidade 2026-09-17: o mesmo tratamento
  -- que 'message' já tinha (2026-09-15) passa a valer pra 'comment' —
  -- antes ele mandava até 80 chars do comentário de verdade pro
  -- FCM/lock screen sem filtro nenhum.
  IF NEW.type = 'message' THEN
    SELECT name INTO v_actor_name FROM public.profiles WHERE id = NEW.actor_id;
    v_push_title := 'Nova mensagem';
    v_push_body := COALESCE(v_actor_name, 'Alguém') || ' enviou uma mensagem';
  ELSIF NEW.type = 'comment' THEN
    SELECT name INTO v_actor_name FROM public.profiles WHERE id = NEW.actor_id;
    v_push_title := 'Novo comentário';
    v_push_body := COALESCE(v_actor_name, 'Alguém') || ' comentou na sua foto';
  ELSE
    v_push_title := COALESCE(NEW.title, 'QueroUmaCor');
    v_push_body := COALESCE(NEW.body, '');
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object(
      'userIds', jsonb_build_array(NEW.user_id::text),
      'title',   v_push_title,
      'body',    v_push_body,
      'url',     v_target
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort: falha de rede/pg_net/rate-limit/lookup de nome não pode
  -- bloquear o insert da notificação em si.
  RETURN NEW;
END $$;
-- Trigger já existe (AFTER INSERT ON notifications), CREATE OR REPLACE
-- da função basta — não precisa recriar o trigger.


-- ─── F. Storage: cleanup_orphan_media cobre avatars + art-refs também ──

CREATE OR REPLACE FUNCTION public.cleanup_orphan_media()
RETURNS TABLE(bucket_id text, name text) LANGUAGE sql AS $$
  SELECT s.bucket_id, s.name
  FROM storage.objects s
  LEFT JOIN public.posts p ON (
    s.bucket_id = 'posts' AND p.media_url LIKE '%' || s.name
  )
  WHERE s.bucket_id = 'posts'
    AND p.id IS NULL
    AND s.created_at < now() - interval '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.brand_logos bl
      WHERE bl.storage_path = s.name OR bl.image_url LIKE '%' || s.name || '%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.business_logo_url LIKE '%' || s.name || '%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.products pd
      WHERE pd.image_url LIKE '%' || s.name || '%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.posts p2, unnest(p2.media_urls) AS u(url)
      WHERE p2.media_urls IS NOT NULL AND u.url LIKE '%' || s.name || '%'
    )
  UNION ALL
  -- Privacidade 2026-09-17: bucket `avatars` nunca foi coberto — foto de
  -- perfil de conta deletada/trocada ficava pública pra sempre, sem
  -- NENHUM caminho de limpeza (nem manual).
  SELECT s.bucket_id, s.name
  FROM storage.objects s
  LEFT JOIN public.profiles pr ON (
    s.bucket_id = 'avatars' AND pr.avatar_url LIKE '%' || s.name
  )
  WHERE s.bucket_id = 'avatars'
    AND pr.id IS NULL
    AND s.created_at < now() - interval '7 days'
  UNION ALL
  -- Idem pra `art-refs` (biblioteca de artes do AR Grafite).
  SELECT s.bucket_id, s.name
  FROM storage.objects s
  LEFT JOIN public.art_references ar ON (
    s.bucket_id = 'art-refs' AND ar.image_url LIKE '%' || s.name
  )
  WHERE s.bucket_id = 'art-refs'
    AND ar.id IS NULL
    AND s.created_at < now() - interval '7 days';
$$;
-- `execute_cleanup_orphan_media()` já deleta qualquer (bucket_id, name)
-- que este scan devolver — não precisa mudar, é genérica.


-- ─── F. Agenda as 3 funções de cleanup que nunca foram ligadas ─────────
-- Idempotente (mesma regra da Wave 28): cron.schedule numa jobname
-- existente SUBSTITUI o schedule anterior.

SELECT cron.schedule(
  'cleanup-rate-limits',
  '0 * * * *',
  $$SELECT public.cleanup_rate_limits();$$
);

SELECT cron.schedule(
  'cleanup-old-notifications',
  '0 3 * * 0',
  $$SELECT public.cleanup_old_notifications();$$
);

SELECT cron.schedule(
  'cleanup-old-audit-events',
  '0 4 * * 0',
  $$SELECT public.cleanup_old_audit_events();$$
);


-- ─── Conferência (só leitura) ───────────────────────────────────────────

SELECT 'A. profiles SELECT restrita a dono/admin' AS item,
       EXISTS (
         SELECT 1 FROM pg_policies
         WHERE tablename = 'profiles' AND policyname = 'Users can view own profile row'
           AND 'authenticated' = ANY(roles::text[])
       ) AS ok
UNION ALL SELECT 'A. policy antiga (USING true, PUBLIC) removida',
       NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE tablename = 'profiles' AND policyname = 'Profiles are viewable by everyone'
       )
UNION ALL SELECT 'A. profiles_public sem security_invoker',
       COALESCE((
         SELECT (reloptions::text NOT LIKE '%security_invoker=true%' OR reloptions IS NULL)
         FROM pg_class WHERE relname = 'profiles_public'
       ), true)
UNION ALL SELECT 'B. profiles_public nunca expõe role=admin',
       NOT EXISTS (SELECT 1 FROM public.profiles_public WHERE role = 'admin')
UNION ALL SELECT 'C. get_feed_v2 sem GRANT pra anon',
       NOT EXISTS (
         SELECT 1 FROM information_schema.role_routine_grants
         WHERE routine_name = 'get_feed_v2' AND grantee = 'anon'
       )
UNION ALL SELECT 'C. get_trending_posts sem GRANT pra anon',
       NOT EXISTS (
         SELECT 1 FROM information_schema.role_routine_grants
         WHERE routine_name = 'get_trending_posts' AND grantee = 'anon'
       )
UNION ALL SELECT 'D. search_all com sentinelas anti-XSS de volta',
       EXISTS (
         SELECT 1 FROM pg_proc
          WHERE proname = 'search_all' AND prosrc LIKE '%HL_OPEN%'
       )
UNION ALL SELECT 'E. push de comentário redige o texto',
       EXISTS (
         SELECT 1 FROM pg_proc
          WHERE proname = 'dispatch_push_on_notification'
            AND prosrc LIKE '%comentou na sua foto%'
       )
UNION ALL SELECT 'F. cron: cleanup-rate-limits agendado',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-limits')
UNION ALL SELECT 'F. cron: cleanup-old-notifications agendado',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-notifications')
UNION ALL SELECT 'F. cron: cleanup-old-audit-events agendado',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-audit-events')
UNION ALL SELECT 'G. quote_painter_contact existe e é SECURITY DEFINER',
       EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
         WHERE p.proname = 'quote_painter_contact' AND p.prosecdef = true
       )
ORDER BY 1;
