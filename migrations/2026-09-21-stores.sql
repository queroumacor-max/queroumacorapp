-- Cadastro de lojas parceiras da /loja (StoreSelector)
-- ────────────────────────────────────────────────────────────────────────
-- A tela de seleção de loja (PR #392) nasceu com um array hardcoded no
-- código só com a Cali Colors — o usuário pediu pra virar cadastro de
-- verdade no portal, pra dar pra registrar loja nova sem deploy. `id` é
-- um slug (não uuid) de propósito: é o mesmo identificador estável que já
-- estava hardcoded no app ('calicolors'), então a migração de "array no
-- código" pra "linha no banco" não muda o valor que o resto do app (futuro
-- carrinho/pedido por loja) vai usar como chave.

CREATE TABLE IF NOT EXISTS public.stores (
  id text PRIMARY KEY,
  name text NOT NULL,
  subtitle text,
  emoji text NOT NULL DEFAULT '🏪',
  active boolean NOT NULL DEFAULT true,
  -- Ordem de exibição no grid do app; empate desempata por nome.
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stores_active_sort
  ON public.stores (active, sort_order);

-- set_updated_at() já existe no banco (criada em
-- 2026-09-06-click-rua-bucket.sql) — CREATE OR REPLACE aqui é só defensivo,
-- pra este arquivo rodar sozinho em qualquer ordem.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stores_updated_at ON public.stores;
CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: leitura liberada (é o diretório de lojas que o app mostra pra
-- qualquer usuário logado escolher) — mesmo padrão de `click_rua_editions`.
-- Escrita só admin do portal.
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_select_all ON public.stores;
CREATE POLICY stores_select_all
  ON public.stores
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS stores_admin_write ON public.stores;
CREATE POLICY stores_admin_write
  ON public.stores
  FOR ALL
  TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());

-- Seed: a Cali Colors já existe e é a única loja hoje — "já aparece" sem
-- precisar cadastrar na mão pelo portal.
INSERT INTO public.stores (id, name, subtitle, emoji, active, sort_order)
VALUES ('calicolors', 'Cali Colors', 'Tintas, texturas e ferramentas', '🎨', true, 0)
ON CONFLICT (id) DO NOTHING;

-- ── Conferência (só leitura) ───────────────────────────────────────────
--   SELECT id, name, active, sort_order FROM public.stores ORDER BY sort_order, name;
-- Esperado: pelo menos 1 linha, 'calicolors' ativa.
