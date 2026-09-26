-- ============================================================================
-- 2026-09-26 — Mensagem de ausência do WhatsApp: reserva ATÔMICA.
--
-- A cortesia ("aqui é da Cali Colors, retornamos em breve") tinha trava de
-- 12h por conversa, mas era ler-e-depois-gravar: o runner lia `away_at`, e
-- só gravava depois de enviar. Duas mensagens do cliente chegando juntas
-- (isolates diferentes do Cloudflare) liam `away_at=null` as duas, e as duas
-- mandavam a cortesia.
--
-- Mesma técnica de `claim_wa_followup_nudge` / `bump_wa_ai_reply_count`:
-- INSERT … ON CONFLICT DO UPDATE … WHERE <fora do cooldown> RETURNING — só
-- um chamador recebe true, serializado pelo lock de linha do Postgres.
--
-- Sem este SQL o código segue funcionando pelo caminho antigo (a RPC ausente
-- vira 'sem_rpc' e a cortesia sai como antes). Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_wa_away(
  p_wa_id text, p_cooldown_hours integer DEFAULT 12
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claimed boolean;
BEGIN
  INSERT INTO public.whatsapp_ai_state (wa_id, away_at, updated_at)
  VALUES (p_wa_id, now(), now())
  ON CONFLICT (wa_id) DO UPDATE SET away_at = now(), updated_at = now()
  WHERE public.whatsapp_ai_state.away_at IS NULL
     OR public.whatsapp_ai_state.away_at < now() - make_interval(hours => p_cooldown_hours)
  RETURNING true INTO v_claimed;
  RETURN coalesce(v_claimed, false);
END $$;

REVOKE ALL ON FUNCTION public.claim_wa_away(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wa_away(text, integer) TO service_role;

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'claim_wa_away existe' AS item,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname='claim_wa_away') AS ok
UNION ALL SELECT 'authenticated sem EXECUTE',
       NOT has_function_privilege('authenticated', 'public.claim_wa_away(text, integer)', 'EXECUTE');
