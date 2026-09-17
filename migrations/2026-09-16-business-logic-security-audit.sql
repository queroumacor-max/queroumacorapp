-- ════════════════════════════════════════════════════════════════════
-- 2026-09-16 — Auditoria de segurança de LÓGICA DE NEGÓCIO (business
-- logic abuse / workflow bypass / state manipulation / race conditions /
-- TOCTOU / idempotency / entitlement abuse). Pedido do usuário: auditoria
-- completa fora do escopo de scanner automático (owasp top 10 "clássico"
-- já tinha sido coberto em rounds anteriores — ver CLAUDE.md).
--
-- Todo achado abaixo foi CONFIRMADO lendo o SQL/RLS realmente vivo (não
-- suposição): supabase_init.sql concatena waves históricas fora de ordem
-- estrita, então "qual versão está no ar" não dá pra deduzir por posição
-- no arquivo — por isso este arquivo é 100% CREATE OR REPLACE / DROP+CREATE
-- idempotente: roda por cima de QUALQUER versão anterior viva e sempre
-- termina no estado seguro descrito abaixo, sem precisar provar qual era
-- o estado de partida.
--
-- Idempotente. Uma seção por achado. Rodar inteiro de uma vez no SQL
-- Editor do Supabase.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- A. [CRÍTICO] PRO grátis pra sempre — pro_expires_at/pro_grace_until
--    NUNCA estiveram protegidos pelo trigger anti-escalada de profiles.
--
--    `protect_profile_columns` reverte is_pro/portal_access/role/verified
--    quando quem tenta mudar não é admin — mas NUNCA tocou em
--    pro_expires_at/pro_grace_until. Como Postgres RLS não restringe
--    COLUNA (só LINHA — `USING(auth.uid()=id) WITH CHECK(auth.uid()=id)`
--    deixa qualquer coluna passar), um PATCH direto via PostgREST bastava:
--
--      PATCH /rest/v1/profiles?id=eq.<self>
--      {"pro_expires_at": "2099-01-01T00:00:00Z"}
--
--    is_pro_active()/requirePro()/canSeeProFeature() todos leem essa
--    coluna sem re-derivar de pagamento algum. E como NADA no app zera
--    is_pro no vencimento (é estado permanente por design — CLAUDE.md,
--    "Auditoria 2 2026-09-01"), quem já foi PRO uma vez (pagamento real,
--    promo, ou o achado B abaixo) vira PRO PERMANENTE de graça com essa
--    única requisição.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trusted boolean;
BEGIN
  -- Revisão de código (Codex, PR #319): a primeira versão checava
  -- `auth.role()`, que é o role do JWT ORIGINAL e NÃO muda dentro de uma
  -- função SECURITY DEFINER — só `current_user` muda (vira o DONO da
  -- função). `redeem_pro_with_points` é SECURITY DEFINER, GRANT pra
  -- `authenticated`, e termina com `UPDATE profiles SET is_pro=true,
  -- pro_expires_at=...`; com o check em `auth.role()`, essa UPDATE
  -- disparava esta trigger com `auth.role()='authenticated'` (o role do
  -- usuário comum que chamou a RPC) e a trigger REVERTIA a ativação de
  -- PRO — debitando os pontos sem conceder nada. `current_user`, por
  -- outro lado, é 'authenticated' num PATCH DIRETO do client (o caso que
  -- queremos bloquear) mas vira o dono da função (não
  -- 'anon'/'authenticated') assim que a escrita passa por dentro de uma
  -- SECURITY DEFINER nossa — exatamente o mesmo padrão já usado na
  -- primeira versão histórica desta função (Wave B2:
  -- `current_user IN ('postgres','supabase_admin','service_role')`).
  v_trusted := public.is_portal_admin() OR current_user NOT IN ('anon', 'authenticated');

  -- INSERT: usuário comum não pode nascer com is_pro/portal/admin/verified
  -- ou datas de PRO já setadas.
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted THEN
      IF NEW.is_pro = true OR NEW.portal_access = true OR NEW.role = 'admin' OR NEW.verified = true
         OR NEW.pro_expires_at IS NOT NULL OR NEW.pro_grace_until IS NOT NULL THEN
        NEW.is_pro := false;
        NEW.portal_access := false;
        NEW.verified := false;
        NEW.pro_expires_at := NULL;
        NEW.pro_grace_until := NULL;
        IF NEW.role = 'admin' THEN NEW.role := 'pintor'; END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: reverte mudança de flags/datas privilegiadas se não-confiável.
  -- pro_expires_at/pro_grace_until ENTRAM aqui agora — essa é a correção
  -- do achado A.
  IF TG_OP = 'UPDATE' THEN
    IF NOT v_trusted THEN
      IF OLD.is_pro          IS DISTINCT FROM NEW.is_pro          THEN NEW.is_pro          := OLD.is_pro;          END IF;
      IF OLD.portal_access   IS DISTINCT FROM NEW.portal_access   THEN NEW.portal_access   := OLD.portal_access;   END IF;
      IF OLD.role            IS DISTINCT FROM NEW.role            THEN NEW.role            := OLD.role;            END IF;
      IF OLD.verified        IS DISTINCT FROM NEW.verified        THEN NEW.verified        := OLD.verified;        END IF;
      IF OLD.pro_expires_at  IS DISTINCT FROM NEW.pro_expires_at  THEN NEW.pro_expires_at  := OLD.pro_expires_at;  END IF;
      IF OLD.pro_grace_until IS DISTINCT FROM NEW.pro_grace_until THEN NEW.pro_grace_until := OLD.pro_grace_until; END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

-- Uma única trigger canônica — derruba os dois nomes históricos possíveis
-- (Wave 3 usava "protect_profile_columns" sem prefixo; a wave de
-- 2026-06-09 usava "trg_protect_profile_columns") pra nunca sobrar duas
-- rodando a mesma função.
DROP TRIGGER IF EXISTS protect_profile_columns ON public.profiles;
DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();


-- ════════════════════════════════════════════════════════════════════
-- B. [CRÍTICO] Auto-promoção a admin via `user_type` — o trigger que
--    sincroniza role<-user_type copiava CEGAMENTE qualquer valor,
--    inclusive 'admin'.
--
--    `trg_sync_role_from_user_type` (2026-06-12) existe pra corrigir
--    perfil que nasceu com `role` vazio (bug de onboarding documentado
--    várias vezes no histórico deste projeto — é um estado real, não
--    hipotético). Só preenchia quando `role` já era NULL/vazio — mas não
--    excluía 'admin' da lista de valores aceitos. `profiles_user_type_check`
--    também aceita 'admin' como valor válido de `user_type` (achado
--    junto). Resultado: uma conta com `role` vazio (perfil incompleto,
--    OAuth pela metade, qualquer falha silenciosa de handle_new_user)
--    virava admin completo com:
--
--      PATCH /rest/v1/profiles?id=eq.<self>  {"user_type":"admin"}
--
--    `is_portal_admin()` aceita `role='admin'` como suficiente,
--    independente da allowlist ADMIN_EMAILS — acesso total a
--    /api/admin/users (promote/set_pro/delete_user), /admin/*, e toda
--    RLS gated por is_portal_admin() (~13 tabelas).
--
--    `user_type` é CATEGORIA PROFISSIONAL (pintor/grafiteiro/automotivo/
--    arquiteto/...), nunca deveria valer 'admin' — nenhum fluxo legítimo
--    de cadastro grava isso. Excluir 'admin' da sincronização não tira
--    nada de ninguém real.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_role_from_user_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.role IS NULL OR NEW.role = '')
     AND NEW.user_type IS NOT NULL AND NEW.user_type <> '' AND NEW.user_type <> 'admin' THEN
    NEW.role := NEW.user_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_role_from_user_type ON public.profiles;
CREATE TRIGGER trg_sync_role_from_user_type
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_from_user_type();


-- ════════════════════════════════════════════════════════════════════
-- C+D+E. [CRÍTICO/ALTO] Farm de pontos grátis via `quotes` → PRO grátis
--        via redeem_pro_with_points.
--
--    Cadeia completa: (C) a policy de INSERT de fallback
--    `quotes_insert_participants` só checava `client_id`/`painter_id`
--    contra `auth.uid()` — nunca que os dois fossem DIFERENTES um do
--    outro. `create_quote_from_post`/`create_painter_draft` (as RPCs)
--    bloqueiam auto-alvo, mas a policy RLS de fallback (a que de fato
--    autoriza o INSERT) não — um POST direto em /rest/v1/quotes com
--    `{client_id: self, painter_id: self}` passava.
--
--    (D) A policy de UPDATE ("Users can update own quotes", nunca
--    dropada) autoriza QUALQUER coluna, inclusive `client_id`/
--    `painter_id`/`status`, pra qualquer participante (WITH CHECK é só
--    um OR entre as duas colunas, não trava QUAL delas mudou). Um
--    participante podia sequestrar orçamento alheio reatribuindo
--    client_id/painter_id pra qualquer uuid, ou (mais grave) usar isso
--    pra fechar o próprio ciclo self-quote → self-approve.
--
--    (E) `award_quote_request_points` credita 5 pontos por INSERT em
--    `quotes` com client_id setado, SEM rate limit nenhum. Somado a (C)+
--    (D): criar quote com client_id=painter_id=self, aprovar/concluir
--    via PATCH direto (o app já permite aprovação manual — CLAUDE.md
--    documenta isso como fluxo intencional pro caso "cliente aprovou por
--    fora"), repetir em loop — pontos ilimitados, sem NENHUM cliente
--    real envolvido. `redeem_pro_with_points` (verificado ATÔMICO e
--    seguro — advisory lock + custo hardcoded) converte pontos em PRO de
--    graça. FIX em 3 partes, fecha a cadeia na raiz (C+D) e põe um teto
--    de defesa-em-profundidade no efeito colateral monetizável (E).
-- ════════════════════════════════════════════════════════════════════

-- (C) INSERT: client_id e painter_id nunca podem ser a MESMA pessoa.
DROP POLICY IF EXISTS quotes_insert_participants ON public.quotes;
CREATE POLICY quotes_insert_participants ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = client_id OR (auth.uid() = painter_id AND client_id IS NULL))
    AND (painter_id IS NULL OR client_id IS NULL OR painter_id <> client_id)
  );

-- (D) UPDATE: client_id/painter_id são atribuídos SÓ na criação — nenhum
-- fluxo legítimo os reatribui depois. Trigger fecha isso independente da
-- policy (defesa em profundidade: mesmo que a RLS de UPDATE volte a ficar
-- permissiva num hardening futuro, esta trigger sozinha já protege).
CREATE OR REPLACE FUNCTION public.protect_quote_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_portal_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN NEW.client_id := OLD.client_id; END IF;
  IF NEW.painter_id IS DISTINCT FROM OLD.painter_id THEN NEW.painter_id := OLD.painter_id; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_quote_ownership ON public.quotes;
CREATE TRIGGER trg_protect_quote_ownership
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.protect_quote_ownership();

-- (E) Teto de defesa-em-profundidade nos pontos por pedido de orçamento —
-- não bloqueia a CRIAÇÃO do orçamento (pedir orçamento pra vários
-- pintores reais é uso legítimo), só o efeito colateral monetizável.
-- Janela do check_rate_limit é fixa em 1 minuto (limitação conhecida do
-- projeto — ver CLAUDE.md); 5/min ainda corta o loop automatizado sem
-- incomodar quem pede orçamento na mão.
CREATE OR REPLACE FUNCTION public.award_quote_request_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rl jsonb;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    BEGIN
      v_rl := public.check_rate_limit(NEW.client_id::text, 'quote-request-points', 5, 1);
    EXCEPTION WHEN OTHERS THEN
      v_rl := jsonb_build_object('allowed', true);
    END;
    IF COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
      INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
      VALUES (NEW.client_id, 5, 'earned', 'quote_request', NEW.id, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_award_quote_request_points ON public.quotes;
CREATE TRIGGER trg_award_quote_request_points
  AFTER INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.award_quote_request_points();


-- ════════════════════════════════════════════════════════════════════
-- F. [ALTO] Auto-avaliação (self-review) + race de avaliação duplicada.
--
--    `submit_review` checava duplicata com `SELECT COUNT(*)` e só DEPOIS
--    fazia o INSERT — sem lock, sem UNIQUE constraint. Duas chamadas
--    concorrentes (double-click, retry de rede) passam as duas pelo
--    COUNT antes de qualquer uma gravar → duas reviews pro mesmo
--    orçamento pelo mesmo reviewer, inflando rating_avg/review_count.
--
--    Também não bloqueava client_id=painter_id: como (C) acima permitia
--    orçamento consigo mesmo, dava pra se autoavaliar 5 estrelas
--    ilimitadamente (orçamento novo a cada vez sidesteps o dedup por
--    quote_id) — manipulação de ranking/busca (suggest_to_follow ordena
--    por rating_avg/review_count).
-- ════════════════════════════════════════════════════════════════════

-- Remove duplicatas que já existam (mantém a mais antiga) ANTES de travar
-- a constraint — senão o ADD CONSTRAINT falha se a race já foi explorada.
DELETE FROM public.reviews r
USING public.reviews r2
WHERE r.quote_id IS NOT NULL
  AND r.quote_id = r2.quote_id
  AND r.reviewer_id = r2.reviewer_id
  AND (r.created_at, r.id) > (r2.created_at, r2.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique_reviewer_quote
  ON public.reviews(quote_id, reviewer_id) WHERE quote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_review(
  p_quote_id   uuid,
  p_painter_id uuid,
  p_rating     integer,
  p_comment    text  DEFAULT NULL,
  p_criteria   jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_owner uuid; v_painter uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para avaliar'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Nota tem que ser de 1 a 5';
  END IF;
  IF p_quote_id IS NOT NULL THEN
    -- Serializa avaliações concorrentes do MESMO orçamento pelo MESMO
    -- reviewer — fecha o TOCTOU do SELECT COUNT antigo. Escopado por
    -- (quote_id, reviewer), não pelo usuário inteiro, pra não travar
    -- alguém avaliando dois orçamentos diferentes ao mesmo tempo.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_quote_id::text || ':' || auth.uid()::text, 0));
    SELECT client_id, painter_id INTO v_owner, v_painter FROM public.quotes WHERE id = p_quote_id;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
    IF v_owner != auth.uid() THEN RAISE EXCEPTION 'Você só pode avaliar os próprios orçamentos'; END IF;
    IF v_painter IS NOT NULL AND v_owner = v_painter THEN
      RAISE EXCEPTION 'Não é possível avaliar um orçamento próprio';
    END IF;
    IF p_painter_id IS NOT NULL AND v_painter IS NOT NULL AND p_painter_id != v_painter THEN
      RAISE EXCEPTION 'Painter informado não bate com o do orçamento';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reviews WHERE quote_id = p_quote_id AND reviewer_id = auth.uid()) THEN
      RAISE EXCEPTION 'Você já avaliou este orçamento';
    END IF;
  END IF;
  INSERT INTO public.reviews (reviewer_id, quote_id, rating, comment, criteria, created_at)
  VALUES (auth.uid(), p_quote_id, p_rating, p_comment, COALESCE(p_criteria, '[]'::jsonb), now())
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Você já avaliou este orçamento';
END $$;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text, jsonb) TO authenticated;


-- ════════════════════════════════════════════════════════════════════
-- G. [MÉDIO/ALTO] `orders` — dono podia se auto-marcar como "pago"/
--    "entregue" e reescrever o total.
--
--    `orders_update_own` (Wave 27, nunca dropada por nome — mesmo que
--    tenha sido "sombreada" por engano em alguma versão do
--    supabase_init.sql, uma trigger BEFORE UPDATE protege
--    independentemente de qual policy de RLS estiver viva) autoriza
--    `USING/WITH CHECK (auth.uid()=user_id)` sem restringir COLUNA — um
--    PATCH direto:
--
--      PATCH /rest/v1/orders?id=eq.<own order>
--      {"status":"paid","paid_amount":<qualquer valor>}
--
--    fazia o próprio pedido aparecer "pago"/"entregue" no portal sem
--    passar pelo WhatsApp (o checkout real, desde a remoção do MP in-app
--    em 2026-06-18). Junto: a funcionalidade legítima "Editar pedido"
--    deixa `total` desatualizado em relação a `items` (bug de dado, não
--    de segurança, mas do mesmo lugar) — a trigger corrige os dois de
--    uma vez: campos de pagamento/status ficam admin/service_role-only,
--    e `total` é SEMPRE recalculado a partir de `items` quando `items`
--    muda (nunca aceito cru do cliente).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_order_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total   numeric;
  v_trusted boolean;
BEGIN
  v_trusted := public.is_portal_admin() OR current_user NOT IN ('anon', 'authenticated');

  -- INSERT: revisão de código (Codex, PR #319) — a 1ª versão só cobria
  -- UPDATE. `orders_insert_own` (WITH CHECK auth.uid()=user_id) deixava
  -- um POST direto criar a order JÁ como `status='paid'` com
  -- paid_amount/tx_id/etc. arbitrários — a proteção nunca entrava em
  -- jogo, porque a linha nascia "pré-violada" em vez de ser alterada
  -- depois. Não referencia OLD (não existe em INSERT).
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted THEN
      NEW.status         := 'pending';
      NEW.paid_amount     := NULL;
      NEW.paid_at         := NULL;
      NEW.tx_id           := NULL;
      NEW.payment_method  := NULL;
      NEW.gateway         := NULL;
      NEW.payment_url     := NULL;
      NEW.installments    := NULL;
      NEW.receipt_url     := NULL;
    END IF;
    -- total sempre derivado de items, nunca aceito cru — igual ao
    -- submitOrder() do app (mesma fórmula: soma de price×qty), então não
    -- muda nada pro fluxo legítimo e fecha o caminho desonesto de propósito.
    SELECT COALESCE(SUM(
      COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'qty')::numeric, 1)
    ), 0)
    INTO v_total
    FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) AS item;
    NEW.total := v_total;
    RETURN NEW;
  END IF;

  -- UPDATE: mesma proteção, agora comparando com OLD.
  IF NOT v_trusted THEN
    IF NEW.status         IS DISTINCT FROM OLD.status         THEN NEW.status         := OLD.status;         END IF;
    IF NEW.paid_amount     IS DISTINCT FROM OLD.paid_amount     THEN NEW.paid_amount     := OLD.paid_amount;     END IF;
    IF NEW.paid_at         IS DISTINCT FROM OLD.paid_at         THEN NEW.paid_at         := OLD.paid_at;         END IF;
    IF NEW.tx_id           IS DISTINCT FROM OLD.tx_id           THEN NEW.tx_id           := OLD.tx_id;           END IF;
    IF NEW.payment_method  IS DISTINCT FROM OLD.payment_method  THEN NEW.payment_method  := OLD.payment_method;  END IF;
    IF NEW.gateway         IS DISTINCT FROM OLD.gateway         THEN NEW.gateway         := OLD.gateway;         END IF;
    IF NEW.payment_url     IS DISTINCT FROM OLD.payment_url     THEN NEW.payment_url     := OLD.payment_url;     END IF;
    IF NEW.installments    IS DISTINCT FROM OLD.installments    THEN NEW.installments    := OLD.installments;    END IF;
    IF NEW.receipt_url     IS DISTINCT FROM OLD.receipt_url     THEN NEW.receipt_url     := OLD.receipt_url;     END IF;
    IF NEW.user_id         IS DISTINCT FROM OLD.user_id         THEN NEW.user_id         := OLD.user_id;         END IF;
  END IF;

  -- total nunca é aceito cru: recalculado a partir de items sempre que
  -- items muda (pra QUALQUER caller, inclusive admin — items é a fonte
  -- da verdade, total é derivado). Se items não mudou, total não é
  -- tocado (não atrapalha correção manual de admin num status-only update).
  IF NEW.items IS DISTINCT FROM OLD.items THEN
    SELECT COALESCE(SUM(
      COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'qty')::numeric, 1)
    ), 0)
    INTO v_total
    FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) AS item;
    NEW.total := v_total;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_order_columns ON public.orders;
CREATE TRIGGER trg_protect_order_columns
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_columns();


-- ════════════════════════════════════════════════════════════════════
-- H. [CRÍTICO] CSAM/moderação de posts — `createPost` insere direto via
--    client, `status='approved'` hardcoded, e NUNCA chama /api/moderate
--    (hash blocklist + Gemini) nem /api/moderate-video. A infra de CSAM
--    (media_hash_blocklist, media_review_queue — Wave 29) protege ZERO
--    do surface mais importante que ela foi construída pra proteger.
--
--    Fechar isso por completo pediria mover a criação de post pro
--    servidor (rota nova chamando /api/moderate ANTES do insert, com
--    status decidido lá) — mudança arquitetural maior, fora do escopo
--    seguro desta sessão sem risco real de regressão no fluxo de
--    publicar (upload de mídia, compressão, etc. continuam 100%
--    client-driven). O que ESTA migration fecha, de forma inquebrável
--    (funciona em QUALQUER caminho de insert, incluindo REST direto):
--    conteúdo com hash JÁ CONHECIDO como CSAM/abuso/spam/denunciado
--    (media_hash_blocklist) nunca vira post, ponto — bloqueado no
--    banco, não só no app. Isso cobre reupload de conteúdo já
--    identificado, que é o caso de uso primário da blocklist.
--
--    O que continua faltando (documentado no relatório final, não
--    corrigido aqui): triagem de conteúdo NOVO/desconhecido (Gemini)
--    continua só no client — quem publica pela UI passa por ela
--    (ver mudança em usePublishPost.ts), mas REST direto ainda pula.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_media_hash_blocklist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.media_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.media_hash_blocklist WHERE hash = NEW.media_hash
  ) THEN
    RAISE EXCEPTION 'Este conteúdo foi identificado e bloqueado por violar as diretrizes da comunidade.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_media_hash_blocklist ON public.posts;
CREATE TRIGGER trg_enforce_media_hash_blocklist
  BEFORE INSERT OR UPDATE OF media_hash ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_media_hash_blocklist();


-- ════════════════════════════════════════════════════════════════════
-- I. [ALTO] `messages` — o destinatário podia reescrever o CONTEÚDO que
--    o remetente mandou, ou apagar do histórico do remetente uma
--    mensagem que não é dele.
--
--    `messages_update_own` (Wave 27) autoriza UPDATE de QUALQUER coluna
--    pra QUALQUER participante (`sender_id=auth.uid() OR
--    receiver_id=auth.uid()`, sem distinção de coluna). O app só chama
--    `.update({deleted_at})`/`.update({read_at})` pela UI — mas nada no
--    banco impede um PATCH direto trocando `content`, `sender_id`,
--    `receiver_id` ou `conversation_id`, adulterando a conversa dos DOIS
--    lados ou apagando (soft-delete é coluna compartilhada, não
--    per-viewer) mensagem que o outro participante mandou.
--
--    Trigger: fora de admin/service_role, `content`/`sender_id`/
--    `receiver_id`/`conversation_id`/`type` são IMUTÁVEIS depois de
--    enviada; `deleted_at` só quem é o `sender` original mexe; `read_at`
--    só quem é o `receiver` original mexe.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_message_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_portal_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.content          IS DISTINCT FROM OLD.content          THEN NEW.content          := OLD.content;          END IF;
  IF NEW.sender_id        IS DISTINCT FROM OLD.sender_id        THEN NEW.sender_id        := OLD.sender_id;        END IF;
  IF NEW.receiver_id      IS DISTINCT FROM OLD.receiver_id      THEN NEW.receiver_id      := OLD.receiver_id;      END IF;
  IF NEW.conversation_id  IS DISTINCT FROM OLD.conversation_id  THEN NEW.conversation_id  := OLD.conversation_id;  END IF;
  IF NEW.type             IS DISTINCT FROM OLD.type             THEN NEW.type             := OLD.type;             END IF;

  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND auth.uid() IS DISTINCT FROM OLD.sender_id THEN
    NEW.deleted_at := OLD.deleted_at;
  END IF;
  IF NEW.read_at IS DISTINCT FROM OLD.read_at AND auth.uid() IS DISTINCT FROM OLD.receiver_id THEN
    NEW.read_at := OLD.read_at;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_message_columns ON public.messages;
CREATE TRIGGER trg_protect_message_columns
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.protect_message_columns();


-- ════════════════════════════════════════════════════════════════════
-- J. [MÉDIO] `messages` — bloqueio (`blocks`) não impedia CHAT nenhum
--    (só filtrava feed/sugestões), e o rate limit de 30/min era por PAR
--    remetente→destinatário — sem teto agregado, um único remetente
--    manda 29 msgs/min pra centenas de destinatários diferentes sem
--    esbarrar em limite nenhum (fan-out de spam/assédio).
--
--    Recria `rate_limit_messages()` (trigger já existe desde
--    2026-09-15, só troca o CORPO da função) com dois acréscimos: nega
--    o INSERT se existe bloqueio em QUALQUER direção entre remetente e
--    destinatário; e um segundo `check_rate_limit` agregado por
--    remetente sozinho.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rate_limit_messages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rl  jsonb;
  v_key text;
BEGIN
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Bloqueio vale pra QUALQUER `type`, inclusive 'system' — revisão de
  -- código (Codex, PR #319): `type` é coluna livre do client (sem CHECK
  -- constraint, `WITH CHECK` do INSERT só exige `auth.uid()=sender_id`),
  -- então a 1ª versão desta trigger devolvia cedo demais pra
  -- `type='system'` e isso pulava JUNTO o check de bloqueio que vem
  -- abaixo — bastava mandar `type:'system'` pra falar com quem te
  -- bloqueou. Só o RATE LIMIT (não o bloqueio) é isento de mensagem de
  -- sistema, e só depois de confirmar que não há bloqueio.
  IF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = NEW.sender_id AND blocked_id = NEW.receiver_id)
       OR (blocker_id = NEW.receiver_id AND blocked_id = NEW.sender_id)
  ) THEN
    RAISE EXCEPTION 'Não é possível enviar mensagem para este usuário';
  END IF;

  IF COALESCE(NEW.type, 'text') = 'system' THEN
    RETURN NEW;
  END IF;

  v_key := NEW.sender_id::text || '>' || NEW.receiver_id::text;
  BEGIN
    v_rl := public.check_rate_limit(v_key, 'chat-message', 30, 1);
  EXCEPTION WHEN OTHERS THEN
    v_rl := NULL; -- infra indisponível: não bloqueia o envio
  END;
  IF v_rl IS NOT NULL AND NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'rate limit: muitas mensagens em pouco tempo, aguarde um instante';
  END IF;

  BEGIN
    v_rl := public.check_rate_limit(NEW.sender_id::text, 'chat-message-global', 60, 1);
  EXCEPTION WHEN OTHERS THEN
    v_rl := NULL;
  END;
  IF v_rl IS NOT NULL AND NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'rate limit: muitas mensagens em pouco tempo, aguarde um instante';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rate_limit_messages ON public.messages;
CREATE TRIGGER trg_rate_limit_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_messages();


-- ════════════════════════════════════════════════════════════════════
-- K. [MÉDIO] `reports` — dedup só cobria denúncia de POST
--    (`idx_reports_unique_per_post WHERE post_id IS NOT NULL`); denúncia
--    de PERFIL/review (post_id NULL, target_user_id setado) podia ser
--    duplicada sem limite pelo mesmo reporter. Nenhum rate limit
--    existia — inundar a fila de moderação (`/admin/reports`) ou
--    forçar ação de moderação contra um alvo via volume de denúncias
--    era possível sem fricção nenhuma.
--
--    CORREÇÃO (revisão de código, Codex, PR #319): a 1ª versão desta
--    seção tentou um índice único (reporter_id, target_user_id) WHERE
--    post_id IS NULL — mas `reports` NÃO tem coluna pra identificar QUAL
--    review foi denunciada (`reportContent()` codifica isso só dentro do
--    texto livre `reason`; a tabela só guarda reporter/post/target_user/
--    reason). Denúncia de PERFIL e denúncia de UMA REVIEW específica de
--    alguém usam o MESMO `target_user_id` — então aquele índice também
--    bloqueava denunciar uma 2ª review diferente da mesma pessoa, ou o
--    perfil depois de já ter denunciado uma review dela: mesma chave,
--    "já existe", nunca mais entra. Removido (DROP explícito, pois o
--    índice já pode ter sido criado por quem rodou a versão anterior
--    desta migration). O rate limit abaixo (10/min por reporter) segue
--    sendo a defesa real contra flood — sem inventar um `review_id`/
--    `target_kind` novo no schema pra decidir dedup direito, o que exige
--    também mudar `reportContent()` no app (fora do escopo desta
--    auditoria).
-- ════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_reports_unique_per_target;

CREATE OR REPLACE FUNCTION public.rate_limit_reports()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rl jsonb;
BEGIN
  BEGIN
    v_rl := public.check_rate_limit(NEW.reporter_id::text, 'report', 10, 1);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF NOT COALESCE((v_rl ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'rate limit: muitas denúncias em pouco tempo, aguarde um instante';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rate_limit_reports ON public.reports;
CREATE TRIGGER trg_rate_limit_reports
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_reports();


-- ════════════════════════════════════════════════════════════════════
-- L. [MÉDIO — perda de dado] `cleanup_orphan_media()` só olhava
--    `posts.media_url` (a 1ª foto) pra decidir o que é órfão — as fotos
--    2-5 do carrossel (`posts.media_urls[]`, Wave 57, 2026-09-01, criada
--    DEPOIS da última vez que esta função foi redefinida) nunca eram
--    reconhecidas como referenciadas. Rodar
--    `execute_cleanup_orphan_media()` (manual, admin) depois de 7 dias
--    apagaria PERMANENTEMENTE fotos 2-5 de qualquer post em carrossel
--    ainda vivo.
-- ════════════════════════════════════════════════════════════════════

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
    -- NOVO: fotos 2-5 do carrossel (posts.media_urls[]).
    AND NOT EXISTS (
      SELECT 1 FROM public.posts p2, unnest(p2.media_urls) AS u(url)
      WHERE p2.media_urls IS NOT NULL AND u.url LIKE '%' || s.name || '%'
    );
$$;


-- ════════════════════════════════════════════════════════════════════
-- M. [BAIXO] `follows` sem trava contra self-follow — inflava
--    followers_count/following_count do próprio usuário em 1 (métrica
--    de vaidade, sem efeito contra terceiros, mas trivial de fechar).
-- ════════════════════════════════════════════════════════════════════

DELETE FROM public.follows WHERE follower_id = following_id;
ALTER TABLE public.follows DROP CONSTRAINT IF EXISTS follows_no_self;
ALTER TABLE public.follows ADD CONSTRAINT follows_no_self CHECK (follower_id <> following_id);


-- ════════════════════════════════════════════════════════════════════
-- N. [BAIXO/MÉDIO — vazamento de informação] `ai_usage_this_month` e
--    `is_pro_active` são RPCs SECURITY DEFINER que recebem `p_user_id`
--    do CHAMADOR e nunca conferiam se batia com `auth.uid()`.
--    `ai_usage_this_month` é GRANT pra `authenticated` — qualquer user
--    logado podia consultar o uso mensal de IA de QUALQUER OUTRO user
--    (`POST /rest/v1/rpc/ai_usage_this_month {"p_user_id":"<vítima>"}`).
--    `is_pro_active` é GRANT até pra `anon`. Nenhum dos dois altera
--    estado (só leitura), mas é enumeração de dado privado de terceiro.
--
--    Os dois continuam funcionando pro uso legítimo: chamada com o
--    PRÓPRIO uid, chamada via service_role (o caminho real de
--    gateAiUsage — usa a service key, então `auth.role()='service_role'`
--    é o caso comum), ou admin.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_usage_this_month(p_user_id uuid, p_feature text DEFAULT NULL)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' OR p_user_id = auth.uid() OR public.is_portal_admin()
    THEN COALESCE((
      SELECT SUM(cost_units) FROM public.ai_usage
      WHERE user_id = p_user_id
        AND used_at >= date_trunc('month', now())
        AND (p_feature IS NULL OR feature = p_feature)
    ), 0)::int
    ELSE 0
  END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_usage_this_month(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_pro_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' OR p_user_id = auth.uid() OR public.is_portal_admin()
    THEN EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id
        AND is_pro = true
        AND (
          pro_expires_at IS NULL
          OR pro_expires_at > now()
          OR (pro_grace_until IS NOT NULL AND pro_grace_until > now())
        )
    )
    ELSE false
  END;
$$;
GRANT EXECUTE ON FUNCTION public.is_pro_active(uuid) TO authenticated, anon, service_role;


-- ════════════════════════════════════════════════════════════════════
-- O. [ALTO — sistêmico] Cota mensal de IA (`gateAiUsage`/`recordAiUsage`
--    em lib/api/security.ts) é um TOCTOU clássico: checa uso via
--    `ai_usage_this_month` (SELECT), chama a IA (segundos), só ENTÃO
--    grava via INSERT. N requisições concorrentes (limitadas só pelo
--    rate-limit por MINUTO da rota — 3 a 30 conforme o endpoint) passam
--    todas pelo check antes de qualquer uma gravar, e todas chamam a IA
--    paga. Sistêmico: as ~15 rotas de IA usam o MESMO par de funções.
--
--    RPC nova, atômica (check + INSERT em UMA transação, serializado por
--    advisory lock por usuário — mesmo padrão comprovado do
--    `redeem_pro_with_points`). O lado TypeScript (security.ts) passa a
--    chamar ela no GATE, antes da chamada de IA — ver Tier 2 do
--    relatório final. `recordAiUsage` (chamada depois do sucesso da IA,
--    nas 15 rotas) vira no-op: o uso já foi gravado no gate, atômico.
--    Efeito colateral aceito e documentado: uma chamada de IA que FALHA
--    depois de reservada ainda consome 1 unidade de cota (troca
--    deliberada: perder 1 unidade de cota numa falha rara é preferível a
--    deixar a cota inteira sem proteção real).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(
  p_user_id uuid, p_feature text, p_limit integer, p_cost integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_used integer; v_cost integer := GREATEST(COALESCE(p_cost, 1), 1);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_usage:' || p_user_id::text, 0));
  SELECT COALESCE(SUM(cost_units), 0) INTO v_used
    FROM public.ai_usage
   WHERE user_id = p_user_id AND used_at >= date_trunc('month', now());
  IF v_used + v_cost > p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', p_limit);
  END IF;
  INSERT INTO public.ai_usage (user_id, feature, used_at, cost_units)
  VALUES (p_user_id, p_feature, now(), v_cost);
  RETURN jsonb_build_object('allowed', true, 'used', v_used + v_cost, 'limit', p_limit);
END $$;

REVOKE ALL ON FUNCTION public.reserve_ai_usage(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(uuid, text, integer, integer) TO service_role;


-- ════════════════════════════════════════════════════════════════════
-- P. [MÉDIO] Teto diário de 30 respostas automáticas do WhatsApp AI
--    (`whatsapp-ai-runner.ts`) também é TOCTOU: lê `replies_today`,
--    gera a resposta (chamada de IA + envio, segundos), só ENTÃO grava
--    o incremento — com o `state` capturado ANTES da IA/envio. Rajada de
--    mensagens do mesmo número gera invocações concorrentes do webhook
--    que todas leem o mesmo contador desatualizado.
--
--    RPC atômica (UPSERT com CASE de virada de dia, mesma técnica
--    comprovada do `check_rate_limit`), chamada ANTES de gerar a
--    resposta em vez de depois de enviar.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bump_wa_ai_reply_count(p_wa_id text, p_max integer, p_today date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.whatsapp_ai_state (wa_id, replies_today, replies_date, updated_at)
  VALUES (p_wa_id, 1, p_today, now())
  ON CONFLICT (wa_id) DO UPDATE SET
    replies_today = CASE
      WHEN public.whatsapp_ai_state.replies_date IS DISTINCT FROM p_today THEN 1
      ELSE public.whatsapp_ai_state.replies_today + 1
    END,
    replies_date = p_today,
    updated_at = now()
  RETURNING replies_today INTO v_count;
  RETURN jsonb_build_object('allowed', v_count <= p_max, 'count', v_count);
END $$;

REVOKE ALL ON FUNCTION public.bump_wa_ai_reply_count(text, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_wa_ai_reply_count(text, integer, date) TO service_role;


-- ════════════════════════════════════════════════════════════════════
-- Conferência (só leitura) — cole o resultado no chat se algo vier false.
-- ════════════════════════════════════════════════════════════════════

SELECT 'A. protect_profile_columns protege pro_expires_at' AS item,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'protect_profile_columns' AND prosrc LIKE '%pro_expires_at%') AS ok
UNION ALL SELECT 'B. sync_role_from_user_type exclui admin',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_role_from_user_type' AND prosrc LIKE '%<> ''admin''%')
UNION ALL SELECT 'C. quotes_insert_participants bloqueia self-target',
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotes' AND policyname = 'quotes_insert_participants' AND with_check LIKE '%painter_id <> client_id%')
UNION ALL SELECT 'D. trigger de ownership de quotes existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_quote_ownership')
UNION ALL SELECT 'E. rate limit em pontos de quote_request existe',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'award_quote_request_points' AND prosrc LIKE '%check_rate_limit%')
UNION ALL SELECT 'F. reviews tem UNIQUE(quote_id,reviewer_id)',
       EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'reviews' AND indexname = 'idx_reviews_unique_reviewer_quote')
UNION ALL SELECT 'F. submit_review bloqueia self-review',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'submit_review' AND prosrc LIKE '%avaliar um orçamento próprio%')
UNION ALL SELECT 'G. trigger de proteção de orders existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_order_columns')
UNION ALL SELECT 'H. trigger de blocklist CSAM em posts existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_media_hash_blocklist')
UNION ALL SELECT 'I. trigger de proteção de messages existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_message_columns')
UNION ALL SELECT 'J. rate_limit_messages checa blocks',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_limit_messages' AND prosrc LIKE '%public.blocks%')
UNION ALL SELECT 'K. reports tem rate limit (índice de dedup por target removido — colidia review×perfil)',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rate_limit_reports')
       AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'reports' AND indexname = 'idx_reports_unique_per_target')
UNION ALL SELECT 'L. cleanup_orphan_media cobre media_urls',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_orphan_media' AND prosrc LIKE '%media_urls%')
UNION ALL SELECT 'M. follows bloqueia self-follow',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_no_self')
UNION ALL SELECT 'N. ai_usage_this_month exige auth.uid()/service_role/admin',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ai_usage_this_month' AND prosrc LIKE '%service_role%')
UNION ALL SELECT 'O. reserve_ai_usage existe (cota de IA atômica)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reserve_ai_usage')
UNION ALL SELECT 'P. bump_wa_ai_reply_count existe (teto diário atômico)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bump_wa_ai_reply_count')
ORDER BY 1;
