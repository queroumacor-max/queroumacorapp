-- ============================================================================
-- 2026-09-26 — Post só vai ao feed depois que o SERVIDOR modera.
--
-- O furo (achado CRÍTICO dos pentests de 16/09 e 18/09, nunca fechado):
-- `posts.status` tinha DEFAULT 'approved' e a policy de INSERT só conferia
-- o dono. A moderação (Gemini + blocklist de hash CSAM) era orquestrada
-- pelo CLIENTE — quem fizesse `POST /rest/v1/posts {status:'approved', …}`
-- direto com o próprio token publicava sem passar por nada. E, depois de
-- aprovado, um PATCH em `media_url` trocava a foto por qualquer outra.
--
-- Agora, pra requisição de USUÁRIO (papéis `authenticated`/`anon` do
-- PostgREST):
--   INSERT → status é SEMPRE 'pending', mande o que mandar. O feed, o perfil
--            público e a busca só mostram 'approved' (ou NULL legado), e a
--            policy de SELECT deixa o dono ver o próprio pendente.
--   UPDATE → só admin do portal muda `status`; trocar a mídia
--            (`media_url`/`media_urls`) volta o post pra 'pending'.
--
-- Quem aprova é a rota /api/posts/approve (service_role): relê o post do
-- banco, baixa cada mídia, confere hash e roda o Gemini
-- (lib/api/_services/post-approval.ts). service_role, SQL Editor e funções
-- SECURITY DEFINER (boost_post, contadores) não passam por esta regra.
--
-- ORDEM DE DEPLOY: o código novo já grava 'pending' e chama a rota, então
-- funciona antes E depois deste SQL. Rodar DEPOIS do deploy — um app antigo
-- aberto (bundle anterior) publicaria foto e ela ficaria pendente pra sempre.
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_post_moderation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- Só requisição de usuário pelo PostgREST. SECURITY INVOKER de propósito:
  -- `current_user` tem que ser o papel de QUEM ESCREVE (em DEFINER seria
  -- sempre o dono da função e a regra nunca valeria).
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    RETURN NEW;
  END IF;

  IF public.is_portal_admin() THEN
    RETURN NEW; -- moderação manual do portal (aprovar/rejeitar) segue livre
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status := OLD.status;
  END IF;
  IF NEW.media_url IS DISTINCT FROM OLD.media_url
     OR NEW.media_urls IS DISTINCT FROM OLD.media_urls THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_post_moderation ON public.posts;
CREATE TRIGGER trg_enforce_post_moderation
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_moderation();

-- O default também deixa de ser 'approved' (defesa em profundidade: um
-- caminho futuro que esqueça o status não nasce público).
ALTER TABLE public.posts ALTER COLUMN status SET DEFAULT 'pending';

-- ── Conferência ─────────────────────────────────────────────────────────
SELECT 'trigger trg_enforce_post_moderation existe' AS item,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_post_moderation'
                 AND tgrelid = 'public.posts'::regclass) AS ok
UNION ALL
SELECT 'posts.status DEFAULT pending',
       (SELECT column_default LIKE '%pending%' FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'status')
UNION ALL
SELECT 'função é SECURITY INVOKER',
       NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'enforce_post_moderation');
