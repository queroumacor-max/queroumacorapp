-- ════════════════════════════════════════════════════════════════════
-- 2026-09-17 — Fecha as 2 pendências deixadas em aberto pela auditoria de
-- lógica de negócio de 2026-09-16 (migrations/2026-09-16-business-logic-
-- security-audit.sql, seções H e O): moderação Gemini não reforçada no
-- servidor no fluxo de publicação, e blocklist de hash CSAM cobrindo só
-- `posts`. As duas eram decisão de produto, não bug — decisão tomada:
-- fazer as duas.
--
-- Idempotente (CREATE OR REPLACE / DROP+CREATE), mesmo padrão do arquivo
-- anterior. Rodar inteiro de uma vez no SQL Editor do Supabase.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- Q. Moderação (Gemini) ganha cota PRÓPRIA, separada da cota de IA do
--    usuário.
--
--    `/api/moderate` e `/api/moderate-video` já chamavam `gateAiUsage`
--    com feature própria ('moderate'/'moderate_video') — mas
--    `reserve_ai_usage` soma TODO uso do mês do usuário sem filtrar por
--    feature (só grava `feature` como metadado/telemetria). Ou seja,
--    moderação consumia a MESMA cota mensal de chat/legenda/etc (30/mês
--    no free). Enquanto moderação só rodava do lado admin isso não doía
--    (ninguém publicando post gastava a própria cota); agora que o
--    publish vai chamar moderação a CADA post (seção do fluxo em
--    usePublishPost.ts, lado código, sem SQL), publicar consumiria cota
--    que o usuário esperava gastar em Alice/Seu Zé/legenda — moderação é
--    feature de SEGURANÇA que roda em nome da plataforma, não um "uso de
--    IA" que a pessoa escolheu gastar.
--
--    `reserve_moderation_usage` é uma reserva atômica IRMÃ de
--    `reserve_ai_usage` (mesmo padrão: advisory lock + check+INSERT numa
--    transação), mas soma só `ai_usage WHERE feature = p_feature` — pool
--    PRÓPRIO por feature de moderação, nunca compartilhado com o pool
--    geral. Teto alto (1000/mês por padrão): é backstop de abuso, não
--    limite de produto — ninguém publica 1000 posts/mês organicamente.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reserve_moderation_usage(
  p_user_id uuid,
  p_feature text,
  p_limit integer DEFAULT 1000,
  p_cost integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used integer;
  v_cost integer := GREATEST(COALESCE(p_cost, 1), 1);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mod_usage:' || p_user_id::text || ':' || COALESCE(p_feature, ''), 0)
  );
  SELECT COALESCE(SUM(cost_units), 0) INTO v_used
    FROM public.ai_usage
   WHERE user_id = p_user_id
     AND feature = p_feature
     AND used_at >= date_trunc('month', now());
  IF v_used + v_cost > p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', p_limit);
  END IF;
  INSERT INTO public.ai_usage (user_id, feature, used_at, cost_units)
  VALUES (p_user_id, p_feature, now(), v_cost);
  RETURN jsonb_build_object('allowed', true, 'used', v_used + v_cost, 'limit', p_limit);
END $$;

REVOKE ALL ON FUNCTION public.reserve_moderation_usage(uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_moderation_usage(uuid, text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_moderation_usage(uuid, text, integer, integer) TO service_role;


-- ════════════════════════════════════════════════════════════════════
-- R. Blocklist de hash CSAM estendida pra avatar e biblioteca de artes
--    (AR Grafite).
--
--    `enforce_media_hash_blocklist` (migration 2026-09-16, seção H) só
--    cobre `posts.media_hash` — a mesma proteção nunca existiu pra
--    `profiles.avatar_url` (upload de foto de perfil) nem pra
--    `art_references.image_url` (biblioteca de referências do AR
--    Grafite). As duas são superfície de upload de imagem por qualquer
--    usuário logado, sem revisão prévia — o mesmo tipo de conteúdo que
--    `media_hash_blocklist` já existe pra bloquear em `posts`, só que
--    sem o gancho de coluna/trigger nessas duas tabelas.
--
--    Mesmo padrão exato da seção H: coluna de hash + índice parcial +
--    trigger BEFORE INSERT OR UPDATE OF <coluna> que estoura exceção se
--    o hash bate na MESMA `media_hash_blocklist` (não é uma blocklist
--    nova — é a mesma tabela, mesma operação admin de banir hash,
--    cobrindo mais superfície).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_hash text;
CREATE INDEX IF NOT EXISTS idx_profiles_avatar_hash
  ON public.profiles(avatar_hash) WHERE avatar_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_avatar_hash_blocklist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.avatar_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.media_hash_blocklist WHERE hash = NEW.avatar_hash
  ) THEN
    RAISE EXCEPTION 'Este conteúdo foi identificado e bloqueado por violar as diretrizes da comunidade.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_avatar_hash_blocklist ON public.profiles;
CREATE TRIGGER trg_enforce_avatar_hash_blocklist
  BEFORE INSERT OR UPDATE OF avatar_hash ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_avatar_hash_blocklist();

ALTER TABLE public.art_references ADD COLUMN IF NOT EXISTS image_hash text;
CREATE INDEX IF NOT EXISTS idx_art_references_image_hash
  ON public.art_references(image_hash) WHERE image_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_art_reference_hash_blocklist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.image_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.media_hash_blocklist WHERE hash = NEW.image_hash
  ) THEN
    RAISE EXCEPTION 'Este conteúdo foi identificado e bloqueado por violar as diretrizes da comunidade.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_art_reference_hash_blocklist ON public.art_references;
CREATE TRIGGER trg_enforce_art_reference_hash_blocklist
  BEFORE INSERT OR UPDATE OF image_hash ON public.art_references
  FOR EACH ROW EXECUTE FUNCTION public.enforce_art_reference_hash_blocklist();


-- ════════════════════════════════════════════════════════════════════
-- Conferência (só leitura) — cole o resultado no chat se algo vier false.
-- ════════════════════════════════════════════════════════════════════

SELECT 'Q. reserve_moderation_usage existe (cota de moderação separada)' AS item,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reserve_moderation_usage') AS ok
UNION ALL SELECT 'Q. reserve_moderation_usage soma só a própria feature (não pool geral)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reserve_moderation_usage' AND prosrc LIKE '%feature = p_feature%')
UNION ALL SELECT 'R. profiles.avatar_hash existe',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='avatar_hash')
UNION ALL SELECT 'R. trigger de blocklist CSAM em avatar existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_avatar_hash_blocklist')
UNION ALL SELECT 'R. art_references.image_hash existe',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='art_references' AND column_name='image_hash')
UNION ALL SELECT 'R. trigger de blocklist CSAM em art_references existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_art_reference_hash_blocklist')
ORDER BY 1;
