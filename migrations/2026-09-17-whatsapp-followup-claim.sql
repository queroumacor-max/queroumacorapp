-- ============================================================================
-- 2026-09-17 — Auditoria de webhooks/integrações externas. Fecha o achado P1
-- do review automático (Codex bot) no PR #328, sobre a própria correção que
-- o PR fazia pro rate limiting da varredura de follow-up
-- (`/api/whatsapp/followup`).
--
-- O QUE O PR #328 JÁ FECHAVA: a varredura lê o estado de cada conversa,
-- manda a mensagem (cobrança/reengajamento) e SÓ DEPOIS marca como feita —
-- check-then-act clássico. Sem nenhuma trava, duas invocações concorrentes
-- (replay de quem tem o segredo de URL, ou duplo clique em "Rodar follow-up
-- agora") mandavam a MESMA mensagem duas vezes pro cliente. O PR fechou isso
-- com uma trava em memória por isolate + rate limit de 4 execuções reais/min
-- na rota.
--
-- O QUE FICOU FALTANDO (achado do Codex, P1): a trava em memória só vale
-- DENTRO do isolate do Cloudflare que recebeu a requisição — cada isolate
-- tem a sua própria cópia da variável. O rate limit reduz o volume, mas não
-- é exclusão mútua: das até 4 invocações que passam por minuto, se duas
-- caírem em isolates DIFERENTES, as duas passam pela trava (cada uma vê a
-- SUA própria, destravada) e podem ler a mesma conversa "ainda não
-- cutucada" antes de qualquer uma escrever — exatamente a corrida que a
-- correção original queria fechar, só que entre isolates em vez de dentro
-- de um só.
--
-- O FIX de verdade só existe onde as duas invocações realmente se
-- encontram: o banco. Este arquivo adiciona a RPC `claim_wa_followup_nudge`
-- pro caso do REENGAJAMENTO (o mais delicado dos dois: a linha de
-- `whatsapp_ai_state` pode não existir ainda pra aquela conversa, e "não
-- existe" e "existe mas está fora do cooldown" precisam contar como
-- reivindicável no MESMO insert atômico — um PATCH condicional sozinho não
-- expressa isso, porque PATCH não cria linha). É a MESMA técnica já
-- comprovada em `bump_wa_ai_reply_count` (Wave da auditoria de negócio
-- 2026-09-16): `INSERT … ON CONFLICT DO UPDATE … WHERE <condição>
-- RETURNING` — atômico via lock de linha do Postgres, serializado pelo
-- próprio banco, não importa de qual isolate a chamada veio.
--
-- O caso da COBRANÇA não precisa de RPC nova: a linha de `portal_alerts`
-- já existe sempre (o alerta nasce antes de qualquer follow-up cogitar
-- cutucar), então um PATCH condicional comum
-- (`?id=eq.<id>&followed_up_at=is.null`) já é atômico do mesmo jeito —
-- corpo vazio na resposta (`return=representation`) = perdeu a corrida.
-- Isso está só no código (`lib/api/_services/whatsapp-followup.ts`), sem
-- SQL.
--
-- TOLERÂNCIA À AUSÊNCIA: enquanto este SQL não rodar, `reservarReengajamento`
-- (no código) trata a RPC ausente/com erro (42883/PGRST202/qualquer falha
-- de rede) como reserva NEGADA — ou seja, reengajamento fica pausado (não
-- manda nada), nunca manda SEM garantia de exclusividade. Diferente da
-- regra usual deste repo ("recurso novo não derruba o que já funciona"),
-- aqui é o oposto de propósito: mandar sem a reserva atômica É o bug que
-- este arquivo fecha, então "não mandar" é o fail-safe certo até a
-- migration rodar.
--
-- Idempotente (CREATE OR REPLACE). Rodar no SQL Editor do Supabase.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_wa_followup_nudge(
  p_wa_id text, p_cooldown_days integer, p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claimed boolean;
BEGIN
  INSERT INTO public.whatsapp_ai_state (wa_id, followup_at, followup_kind, updated_at)
  VALUES (p_wa_id, p_now, 'reengajamento', p_now)
  ON CONFLICT (wa_id) DO UPDATE SET
    followup_at = p_now,
    followup_kind = 'reengajamento',
    updated_at = p_now
  WHERE public.whatsapp_ai_state.followup_at IS NULL
     OR public.whatsapp_ai_state.followup_at < p_now - (p_cooldown_days || ' days')::interval
  RETURNING true INTO v_claimed;
  RETURN coalesce(v_claimed, false);
END $$;

REVOKE ALL ON FUNCTION public.claim_wa_followup_nudge(text, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wa_followup_nudge(text, integer, timestamptz) TO service_role;

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'claim_wa_followup_nudge existe (reserva atômica do reengajamento)' AS item,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='claim_wa_followup_nudge') AS ok
UNION ALL SELECT 'assinatura aceita p_wa_id/p_cooldown_days/p_now',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='claim_wa_followup_nudge'
                   AND pg_get_function_identity_arguments(p.oid) = 'p_wa_id text, p_cooldown_days integer, p_now timestamp with time zone') AS ok
UNION ALL SELECT 'a reserva é condicional (WHERE cooldown/nulo no corpo)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='claim_wa_followup_nudge'
                 AND prosrc LIKE '%followup_at IS NULL%')
ORDER BY 1;

-- Prova funcional (roda com service_role):
--   SELECT public.claim_wa_followup_nudge('wa-teste-claim-1', 7, now());  -- true (1ª vez)
--   SELECT public.claim_wa_followup_nudge('wa-teste-claim-1', 7, now());  -- false (ainda dentro do cooldown)
--   SELECT public.claim_wa_followup_nudge('wa-teste-claim-1', 0, now());  -- true (cooldown 0 dias = sempre reivindicável)
--   DELETE FROM public.whatsapp_ai_state WHERE wa_id = 'wa-teste-claim-1'; -- limpeza do teste
