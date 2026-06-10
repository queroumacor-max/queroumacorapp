-- SQL Wave 25 (2026-06-10) — tabela product_variants (quartinho/galão/lata)
-- ────────────────────────────────────────────────────────────────────────
-- Base atual: 4171 produtos, todos com volume "18L". Pra o usuário poder
-- escolher tamanho (quartinho 900ml, galão 3.6L, lata 18L etc), criamos
-- uma tabela de variantes 1:N.
--
-- product.price continua sendo o preço-base (fallback quando não há
-- variantes cadastradas — comportamento atual). Quando há variantes,
-- a UI mostra seletor e ignora products.price.

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- Label exibido na UI ("Quartinho", "Galão", "Lata", "Balde 18L").
  size_label text NOT NULL,
  -- Volume em ml — opcional mas útil pra ordenação/cálculo de preço/L.
  -- 900 pra quartinho, 3600 pra galão 3.6L, 18000 pra lata 18L.
  volume_ml int,
  -- Preço da variante em BRL (numeric pra evitar float drift). NOT NULL
  -- porque variante sem preço não faz sentido.
  price numeric NOT NULL CHECK (price >= 0),
  -- Stock controlado por variante. NULL = não rastreado (igual products).
  stock int,
  -- Ordem visual no seletor (menor primeiro). Default 0 cai no nome.
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Garante que (product_id, size_label) é único — sem duplicar "Galão"
-- pro mesmo produto.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_unique
  ON public.product_variants (product_id, size_label);

-- Lookup rápido por produto, já ordenado.
CREATE INDEX IF NOT EXISTS idx_product_variants_product_sort
  ON public.product_variants (product_id, sort_order, size_label);

-- Trigger updated_at — reusa função padrão se já existir, senão cria.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_variants_updated_at ON public.product_variants;
CREATE TRIGGER trg_product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: leitura pública (catálogo aberto, igual products). Escrita só admin.
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_variants_select_all ON public.product_variants;
CREATE POLICY product_variants_select_all
  ON public.product_variants
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS product_variants_admin_write ON public.product_variants;
CREATE POLICY product_variants_admin_write
  ON public.product_variants
  FOR ALL
  TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());
