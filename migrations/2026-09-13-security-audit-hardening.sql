-- ============================================================================
-- 2026-09-13 — Auditoria de rate limiting / abuse. Dois achados de banco,
-- os dois com evidência concreta (não suspeita):
--
--   A) `check_rate_limit(p_user_id uuid, ...)` — o parâmetro é UUID, mas
--      TODA chave que não é um id de usuário puro (IP, e-mail, chave
--      composta) é uma STRING como "ip:203.0.113.5", "u:<uuid>",
--      "ip:203.0.113.5:login", "log-error:203.0.113.5",
--      "push-notify:203.0.113.5" — nenhuma delas é um UUID válido.
--      PostgREST recusa o cast (22P02, HTTP 400) e o código de
--      `checkRateLimit` (lib/api/security.ts) trata QUALQUER `!res.ok`
--      como "serviço indisponível" → FAIL-OPEN silencioso. Resultado: o
--      rate limit por IP NUNCA funcionou em nenhum destes caminhos —
--      não é "raro estourar", é "nunca chegou a rodar":
--        - login/signup/reset por IP (checkAuthRateLimit) — a defesa
--          contra brute force e criação em massa de conta está morta
--          desde que foi escrita;
--        - `/api/log-error` por IP (log flooding / Sentry cost abuse);
--        - `/api/push-notify` por IP (defesa contra vazamento do
--          PUSH_INTERNAL_SECRET);
--        - os 7 endpoints que usam `enforceRateLimit`: checkout,
--          delete-account, upload-style-ref, apple-iap-verify,
--          play-billing-verify, cidades, reverse-geocode,
--          auth/set-session-cookie.
--      O teste existente (`__tests__/api/security-ratelimit.test.ts`)
--      nunca pegou isso porque só mocka respostas 200 — nunca simula o
--      400 real que o Postgres devolveria pra um UUID inválido. Rodar
--      `SELECT '22P02'::text` não prova nada aqui; o teste que prova é
--      tentar a RPC com uma chave não-UUID de verdade (ver item de
--      conferência no fim deste arquivo).
--      FIX: a coluna e o parâmetro passam a ser `text`. Qualquer UUID
--      continua sendo uma string válida — não quebra os poucos
--      caminhos que já mandavam UUID puro (me-export, moderate,
--      moderate-video, quote-pdf-upload, gateProAI/gateAiUsage,
--      wa-suggest, admin-*, whatsapp/send).
--
--   B) `search_all(p_query, p_limit)` sem GRANT restrito nem clamp no
--      `LIMIT`. Duas coisas ruins juntas: (1) função criada sem REVOKE
--      explícito herda o EXECUTE default do Postgres pra PUBLIC — ou
--      seja, `anon` (a chave pública, visível em qualquer bundle do
--      app) pode chamar `POST /rest/v1/rpc/search_all` DIRETO no
--      Supabase, sem passar pelo `/search` do Next.js e sem qualquer
--      rate limit nosso; (2) o `p_limit` do cliente vai direto pro
--      `LIMIT` da query, sem teto — `p_limit=2000000000` é aceito.
--      Isso é o item 47/48 da auditoria: RLS sozinha (aqui nem RLS
--      entra, é SELECT com STABLE em tabela com RLS de leitura pública)
--      não limita volume, e o app já decidiu (login obrigatório desde
--      2026-06-18) que a busca é recurso de usuário autenticado.
--      FIX: `LIMIT LEAST(coalesce(p_limit,20), 100)` + REVOKE de
--      PUBLIC/anon + GRANT só pra authenticated.
--
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar de novo sem
-- efeito colateral). UMA instrução por vez se o editor mutilar o paste.
-- ============================================================================

-- ── A. rate_limits / check_rate_limit: uuid → text ─────────────────────────

ALTER TABLE public.rate_limits
  ALTER COLUMN user_id TYPE text USING user_id::text;

-- A assinatura muda de tipo (uuid → text): CREATE OR REPLACE não troca o
-- tipo de parâmetro de uma função existente (cria uma 2ª sobrecarga em vez
-- de substituir) — por isso o DROP explícito da versão antiga primeiro.
DROP FUNCTION IF EXISTS public.check_rate_limit(uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id text, p_endpoint text, p_limit integer DEFAULT 30, p_window_minutes integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_window timestamptz; v_count integer;
BEGIN
  v_window := date_trunc('minute', now());
  INSERT INTO public.rate_limits (user_id, endpoint, window_start, count)
  VALUES (p_user_id, p_endpoint, v_window, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'retry_after_seconds', GREATEST(1, 60 - EXTRACT(SECOND FROM now())::integer)
  );
END $$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

-- ── B. search_all: teto no LIMIT + acesso só a quem está logado ────────────
-- Mesma assinatura (p_query text, p_limit int) — CREATE OR REPLACE basta.

CREATE OR REPLACE FUNCTION public.search_all(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE(
  result_type text,
  id text,
  title text,
  snippet text,
  score real
) LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT plainto_tsquery('portuguese', p_query) AS tsq)
  SELECT 'profile' AS result_type, p.id::text, p.name AS title,
    ts_headline('portuguese', coalesce(p.bio,''), q.tsq) AS snippet,
    ts_rank(p.search_vector, q.tsq) AS score
  FROM public.profiles p, q
  WHERE p.search_vector @@ q.tsq
  UNION ALL
  SELECT 'post' AS result_type, po.id::text, left(coalesce(po.caption,''), 80) AS title,
    ts_headline('portuguese', coalesce(po.caption,''), q.tsq) AS snippet,
    ts_rank(po.search_vector, q.tsq) AS score
  FROM public.posts po, q
  WHERE po.search_vector @@ q.tsq
    AND po.status = 'approved'
  UNION ALL
  SELECT 'product' AS result_type, pr.id::text, pr.name AS title,
    ts_headline('portuguese', coalesce(pr.description,''), q.tsq) AS snippet,
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

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'rate_limits.user_id é text' AS item,
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='rate_limits' AND column_name='user_id') = 'text' AS ok
UNION ALL SELECT 'check_rate_limit aceita p_user_id text',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='check_rate_limit'
                   AND pg_get_function_identity_arguments(p.oid) = 'p_user_id text, p_endpoint text, p_limit integer, p_window_minutes integer')
UNION ALL SELECT 'check_rate_limit(uuid,...) antiga NÃO existe mais',
       NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public' AND p.proname='check_rate_limit'
                       AND pg_get_function_identity_arguments(p.oid) LIKE 'p_user_id uuid%')
UNION ALL SELECT 'search_all sem GRANT pra anon/public',
       NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                     WHERE routine_schema='public' AND routine_name='search_all'
                       AND grantee IN ('anon','PUBLIC'))
UNION ALL SELECT 'search_all GRANT pra authenticated',
       EXISTS (SELECT 1 FROM information_schema.routine_privileges
                 WHERE routine_schema='public' AND routine_name='search_all'
                   AND grantee='authenticated')
ORDER BY 1;

-- Prova funcional do item A (roda com a chave de service_role — CUIDADO,
-- é a MESMA rota que o app usa; escreve uma linha de teste na janela atual
-- e conta como 1 chamada real do endpoint 'security-audit-smoke'):
--   SELECT public.check_rate_limit('ip:203.0.113.5:login', 'security-audit-smoke', 999, 1);
-- Antes do fix (coluna uuid) isso ERA rejeitado com 22P02 e o app tratava
-- como fail-open silencioso. Depois do fix, devolve
-- {"allowed":true,"count":1,...} — a prova de que a chave por IP agora é
-- aceita e contada de verdade.
