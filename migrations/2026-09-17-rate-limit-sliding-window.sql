-- ============================================================================
-- 2026-09-17 — Continuação da auditoria de CI/CD/supply chain: fecha a
-- pendência "janela fixa de 1 min no check_rate_limit" que várias entradas
-- do CLAUDE.md listavam como "aceito como risco baixo, não corrigido".
--
-- O PROBLEMA: `check_rate_limit` bucketiza por `date_trunc('minute', now())`
-- — uma janela FIXA de calendário, não uma janela DESLIZANTE. Isso permite
-- dobrar o volume efetivo batendo bem na virada do minuto: um limite de
-- 30/min pode, na prática, deixar passar até ~60 requisições em ~2 segundos
-- reais (29 no fim do minuto N + 30 no início do minuto N+1), porque os
-- dois buckets são contados de forma totalmente independente.
--
-- O FIX é o algoritmo clássico de "sliding window counter" (2 buckets, sem
-- precisar de log por evento nem mudar o schema de `rate_limits`): a
-- contagem "estimada" na janela deslizante é
--
--   estimado = contagem_do_bucket_atual
--            + contagem_do_bucket_anterior * (1 - fração_decorrida_do_atual)
--
-- No início do minuto novo, fração_decorrida ≈ 0 → o bucket anterior ainda
-- pesa quase 100%, então bater na virada não dobra mais o limite. No fim do
-- minuto, fração_decorrida ≈ 1 → o bucket anterior pesa quase 0, e o
-- resultado converge pro comportamento de janela fixa de sempre (correto:
-- não há mais nada do bucket anterior "vazando" pra essa altura do relógio).
--
-- ESCOPO DA GENERALIZAÇÃO: hoje TODO caller (JS via `lib/api/security.ts`
-- `checkRateLimit`/`enforceRateLimit`, e cada `check_rate_limit(...)` em SQL
-- — chat-message, chat-message-global, push-dispatch, quote-request-points,
-- report) usa `p_window_minutes=1` (o default; nenhum passa outro valor —
-- conferido em toda a árvore de migrations e em `next-app/lib/api`). O fix
-- abaixo é exato para esse caso, que é 100% dos casos reais. Pra
-- `p_window_minutes > 1` ele generaliza olhando só o bucket 1×window atrás
-- (aproximação: reduz o mesmo problema de boundary, mas não é uma janela
-- deslizante multi-bucket completa) — documentado no comentário da função;
-- não vale a pena um algoritmo mais complexo pra um caso que ninguém usa.
--
-- COMPATIBILIDADE: mesma assinatura (`text, text, integer, integer`) e
-- mesmo tipo de retorno (jsonb com `allowed`/`count`/`limit`/
-- `retry_after_seconds`) — `CREATE OR REPLACE` basta, sem DROP. Todo
-- caller em SQL só lê a chave `allowed` (`(v_rl ->> 'allowed')::boolean`);
-- o único lugar que lê `count` é `rateLimitResponse` em `lib/api/
-- security.ts`, só pra montar a mensagem "Limite atingido (X/Y)" — passa a
-- mostrar a contagem ESTIMADA da janela deslizante (arredondada), mais fiel
-- ao que de fato bloqueou a requisição do que a contagem crua do bucket do
-- minuto corrente.
--
-- Idempotente. Rodar no SQL Editor do Supabase.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id text, p_endpoint text, p_limit integer DEFAULT 30, p_window_minutes integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window timestamptz;
  v_window_minutes integer := GREATEST(COALESCE(p_window_minutes, 1), 1);
  v_window_seconds integer := v_window_minutes * 60;
  v_count integer;
  v_prev_count integer;
  v_elapsed_fraction double precision;
  v_estimated numeric;
BEGIN
  v_window := date_trunc('minute', now());

  INSERT INTO public.rate_limits (user_id, endpoint, window_start, count)
  VALUES (p_user_id, p_endpoint, v_window, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  -- Bucket anterior (v_window_minutes atrás). Com v_window_minutes=1 (o
  -- único valor usado hoje) é sempre o minuto de calendário imediatamente
  -- anterior, que também é bucketizado por date_trunc('minute', ...) — a
  -- mesma granularidade em que o INSERT acima grava.
  SELECT count INTO v_prev_count
  FROM public.rate_limits
  WHERE user_id = p_user_id
    AND endpoint = p_endpoint
    AND window_start = v_window - (v_window_minutes || ' minutes')::interval;

  v_elapsed_fraction := LEAST(1.0, GREATEST(0.0,
    EXTRACT(EPOCH FROM (now() - v_window)) / v_window_seconds
  ));
  v_estimated := v_count + COALESCE(v_prev_count, 0) * (1 - v_elapsed_fraction);

  RETURN jsonb_build_object(
    'allowed', v_estimated <= p_limit,
    'count', round(v_estimated),
    'limit', p_limit,
    'retry_after_seconds', GREATEST(1, v_window_seconds - EXTRACT(EPOCH FROM (now() - v_window))::integer)
  );
END $$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'check_rate_limit ainda aceita p_user_id text (assinatura intacta)' AS item,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='check_rate_limit'
                   AND pg_get_function_identity_arguments(p.oid) = 'p_user_id text, p_endpoint text, p_limit integer, p_window_minutes integer') AS ok
UNION ALL SELECT 'check_rate_limit usa sliding window (corpo cita window_start - interval)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='check_rate_limit'
                 AND prosrc LIKE '%v_window - (v_window_minutes%')
ORDER BY 1;

-- Prova funcional (roda com service_role — escreve linhas reais na janela
-- atual do endpoint 'security-audit-smoke'):
--   SELECT public.check_rate_limit('ip:203.0.113.9:sliding-test', 'security-audit-smoke', 5, 1);
-- Chamar 5x seguidas dentro do mesmo minuto: a 6ª volta 'allowed:false'. Se
-- rodar de novo bem no início do PRÓXIMO minuto (antes do bucket anterior
-- decair), o `count` estimado já nasce alto (herdando peso do bucket
-- anterior) em vez de resetar pra 1 — é essa herança que fecha o "dobrar na
-- virada do minuto".
