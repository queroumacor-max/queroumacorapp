-- ============================================================================
-- 2026-09-13 — Aba WhatsApp do portal: "57014: canceling statement due to
-- statement timeout" ao carregar as conversas.
--
-- Rodar no SQL Editor do Supabase, UMA instrução por vez se o editor mutilar
-- o paste (mesma pegadinha 42601 da Wave 26). Tudo aqui é idempotente.
--
-- O QUE ESTAVA CUSTANDO OS 8 SEGUNDOS (statement_timeout do papel
-- `authenticated`):
--
--   1. As policies de RLS chamavam `is_portal_admin()` SOLTA no USING. A
--      função é SECURITY DEFINER (não pode ser inlined), então o Postgres a
--      chamava UMA VEZ POR LINHA — cada chamada é um SELECT em `profiles` +
--      `to_jsonb`. Um `count: 'exact'` sobre 90 dias de mensagens virava
--      dezenas de milhares de consultas escondidas. `(select is_portal_admin())`
--      vira InitPlan: avaliada UMA vez por statement. Mesma regra, mesma
--      segurança, ordens de grandeza mais barato (recomendação oficial do
--      Supabase pra função em policy).
--
--   2. A lista pagina por `ORDER BY created_at DESC, id DESC` e o índice era
--      só `(created_at desc)` — cada página reordenava o recorte inteiro.
--      Índice composto casa com a ordem da paginação.
--
--   3. O poll de 1 minuto filtra `created_at >= x OR delivery_status_at >= x`
--      e não havia índice em `delivery_status_at`: OR sem índice nos dois
--      lados é varredura sequencial. Índice parcial (só linhas com status).
--
--   4. O portal baixava TODAS as mensagens dos 90 dias pra montar a coluna de
--      conversas no navegador. `whatsapp_conversas()` faz esse resumo no
--      banco (uma linha por conversa: última mensagem, não lidas, chave da
--      IA, marca de leitura, canal) — o que atravessa a rede cai de dezenas
--      de milhares de linhas pra algumas centenas. `whatsapp_nao_lidas()` é
--      o número do badge do menu, que antes também baixava 30 dias de
--      mensagens a cada 45 s.
--
-- SEGURANÇA (nada abre):
--   - As policies continuam exigindo `is_portal_admin()`; só muda COMO o
--     Postgres a avalia.
--   - As funções são SECURITY DEFINER pra não pagar a RLS por linha, mas a
--     PRIMEIRA coisa que fazem é `is_portal_admin()` e, sem ela, estouram
--     `insufficient_privilege` (42501). Não há caminho pra quem não é admin
--     ler uma linha sequer. `search_path` fixado, GRANT só pra
--     `authenticated`, REVOKE de `anon` e `public`.
-- ============================================================================

-- ── 1. Policies: função avaliada UMA vez por consulta ──────────────────────

DROP POLICY IF EXISTS "whatsapp_messages admin select" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages admin select" ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING ((SELECT public.is_portal_admin()));

DROP POLICY IF EXISTS whatsapp_ai_state_portal ON public.whatsapp_ai_state;
CREATE POLICY whatsapp_ai_state_portal ON public.whatsapp_ai_state
  FOR ALL TO authenticated
  USING ((SELECT public.is_portal_admin()))
  WITH CHECK ((SELECT public.is_portal_admin()));

DROP POLICY IF EXISTS portal_alerts_portal ON public.portal_alerts;
CREATE POLICY portal_alerts_portal ON public.portal_alerts
  FOR ALL TO authenticated
  USING ((SELECT public.is_portal_admin()))
  WITH CHECK ((SELECT public.is_portal_admin()));

DROP POLICY IF EXISTS whatsapp_ai_config_portal ON public.whatsapp_ai_config;
CREATE POLICY whatsapp_ai_config_portal ON public.whatsapp_ai_config
  FOR ALL TO authenticated
  USING ((SELECT public.is_portal_admin()))
  WITH CHECK ((SELECT public.is_portal_admin()));

-- ── 2. Índices ─────────────────────────────────────────────────────────────

-- Ordem exata da paginação da aba (created_at DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_id
  ON public.whatsapp_messages (created_at DESC, id DESC);

-- Poll: "status de entrega confirmado depois de X" (só linhas com status).
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status_at
  ON public.whatsapp_messages (delivery_status_at DESC)
  WHERE delivery_status_at IS NOT NULL;

-- Badge e não lidas: só o que foi RECEBIDO, por conversa e por data.
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_in_wa_created
  ON public.whatsapp_messages (wa_id, created_at DESC)
  WHERE direction = 'in';

-- Nome do lead pelo telefone da conversa: a aba pedia
-- `phone ILIKE '%1234'` (varredura das 61 mil linhas a cada lote). O
-- índice cobre `leads_por_telefone()` abaixo: 8 últimos dígitos, sem
-- máscara, comparados por igualdade.
CREATE INDEX IF NOT EXISTS idx_leads_phone_sufixo8
  ON public.leads (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8));

-- ── 3. Resumo das conversas (uma linha por número) ─────────────────────────
-- plpgsql, e não sql, DE PROPÓSITO: a guarda tem que ESTOURAR pra quem não é
-- admin. Uma função sql que devolvesse zero linhas seria lida pela tela como
-- "não há conversas" — a mesma armadilha do `update` que não acha linha.

CREATE OR REPLACE FUNCTION public.whatsapp_conversas(p_desde timestamptz)
RETURNS TABLE (
  wa_id        text,
  ultima       jsonb,        -- a última mensagem, linha inteira
  nome         text,         -- profile_name mais recente de quem escreveu
  canal        text,         -- origem da última mensagem ENVIADA (portal/ia/celular)
  nao_lidas    integer,      -- recebidas depois de last_read_at
  enabled      boolean,      -- chave da IA na conversa (NULL = padrão global)
  last_why     text,
  last_at      timestamptz,
  last_read_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_portal_admin() THEN
    RAISE EXCEPTION 'whatsapp_conversas: acesso de portal necessário'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH ult AS (
    SELECT DISTINCT ON (m.wa_id) m.wa_id, m.id, m.created_at
    FROM public.whatsapp_messages m
    WHERE m.created_at >= p_desde
    ORDER BY m.wa_id, m.created_at DESC, m.id DESC
  ),
  nomes AS (
    SELECT DISTINCT ON (m.wa_id) m.wa_id, m.profile_name
    FROM public.whatsapp_messages m
    WHERE m.direction = 'in' AND m.profile_name IS NOT NULL AND m.profile_name <> ''
      AND m.wa_id IN (SELECT u.wa_id FROM ult u)
    ORDER BY m.wa_id, m.created_at DESC, m.id DESC
  ),
  canais AS (
    SELECT DISTINCT ON (m.wa_id) m.wa_id,
           COALESCE(m.origin, CASE WHEN m.sent_by IS NOT NULL THEN 'portal' END) AS canal
    FROM public.whatsapp_messages m
    WHERE m.direction = 'out' AND (m.origin IS NOT NULL OR m.sent_by IS NOT NULL)
      AND m.wa_id IN (SELECT u.wa_id FROM ult u)
    ORDER BY m.wa_id, m.created_at DESC, m.id DESC
  )
  SELECT u.wa_id,
         to_jsonb(m) AS ultima,
         n.profile_name AS nome,
         c.canal,
         (SELECT count(*)::integer FROM public.whatsapp_messages i
           WHERE i.wa_id = u.wa_id AND i.direction = 'in'
             AND (s.last_read_at IS NULL OR i.created_at > s.last_read_at)) AS nao_lidas,
         s.enabled, s.last_why, s.last_at, s.last_read_at
  FROM ult u
  JOIN public.whatsapp_messages m ON m.id = u.id
  LEFT JOIN nomes n ON n.wa_id = u.wa_id
  LEFT JOIN canais c ON c.wa_id = u.wa_id
  LEFT JOIN public.whatsapp_ai_state s ON s.wa_id = u.wa_id
  ORDER BY u.created_at DESC;
END;
$$;

-- ── 4. Badge do menu: quantas mensagens recebidas ninguém abriu ────────────

CREATE OR REPLACE FUNCTION public.whatsapp_nao_lidas(p_desde timestamptz)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_portal_admin() THEN
    RAISE EXCEPTION 'whatsapp_nao_lidas: acesso de portal necessário'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*)::integer INTO n
  FROM public.whatsapp_messages m
  LEFT JOIN public.whatsapp_ai_state s ON s.wa_id = m.wa_id
  WHERE m.direction = 'in' AND m.created_at >= p_desde
    AND (s.last_read_at IS NULL OR m.created_at > s.last_read_at);
  RETURN COALESCE(n, 0);
END;
$$;

-- ── 5. Lead pelo telefone (8 últimos dígitos) ──────────────────────────────
-- SECURITY INVOKER de propósito: a RLS de `leads` continua valendo pra quem
-- chama, exatamente como no `select` direto que o portal fazia.

CREATE OR REPLACE FUNCTION public.leads_por_telefone(p_sufixos text[])
RETURNS SETOF public.leads
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT l.*
  FROM public.leads l
  WHERE right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 8) = ANY (p_sufixos)
  ORDER BY l.id;
$$;

-- ── 6. Permissões ──────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.whatsapp_conversas(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.whatsapp_nao_lidas(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leads_por_telefone(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversas(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_nao_lidas(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leads_por_telefone(text[]) TO authenticated, service_role;

-- ── 7. Conferência ─────────────────────────────────────────────────────────
-- Tudo `true` = rodou inteiro. (Também na 2026-09-05-conferencia-pendencias.sql.)
SELECT 'policy whatsapp_messages avaliada uma vez (initplan)' AS item,
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename='whatsapp_messages'
                 AND qual LIKE '%SELECT%is_portal_admin%') AS ok
UNION ALL SELECT 'idx_whatsapp_messages_created_id',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_whatsapp_messages_created_id')
UNION ALL SELECT 'idx_whatsapp_messages_status_at',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_whatsapp_messages_status_at')
UNION ALL SELECT 'idx_whatsapp_messages_in_wa_created',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_whatsapp_messages_in_wa_created')
UNION ALL SELECT 'idx_leads_phone_sufixo8',
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_leads_phone_sufixo8')
UNION ALL SELECT 'função whatsapp_conversas',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='whatsapp_conversas')
UNION ALL SELECT 'função whatsapp_nao_lidas',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='whatsapp_nao_lidas')
UNION ALL SELECT 'função leads_por_telefone',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='leads_por_telefone')
ORDER BY 1;

-- Sanidade (como admin, no portal — no SQL Editor a sessão é postgres e
-- `auth.uid()` é NULL, então aqui as funções vão ESTOURAR 42501, e isso é
-- o comportamento certo, não um defeito):
--   SELECT * FROM public.whatsapp_conversas(now() - interval '90 days') LIMIT 5;
