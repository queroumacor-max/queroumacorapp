-- 2026-06-15 — Loja aberta pro visitante (modo guest).
--
-- Contexto: o "modo visitante" deixa clientes navegarem feed/loja/perfis sem
-- login. O feed funciona porque get_feed_v2 é RPC SECURITY DEFINER com GRANT
-- pra `anon`. A loja, porém, lê a tabela `products` (e `product_variants`)
-- DIRETO via PostgREST, então fica sujeita a RLS no role `anon`. Se o SELECT
-- dessas tabelas estiver restrito a `authenticated`, o visitante recebe ZERO
-- linhas e a loja abre vazia ("Sem produtos cadastrados").
--
-- Este script garante leitura pública (catálogo é dado público por natureza:
-- nome, preço, estoque, imagem). Additivo (policies são OR'd) e idempotente —
-- não altera o que `authenticated` já enxerga.

-- products ──────────────────────────────────────────────────────────────────
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products public read" ON public.products;
CREATE POLICY "products public read"
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- product_variants (Wave 25) ────────────────────────────────────────────────
-- A tabela já existe; garante leitura anon também (seletor de tamanhos no
-- detalhe do produto). Guard defensivo caso a tabela ainda não exista.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'product_variants'
  ) THEN
    EXECUTE 'ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "product_variants public read" ON public.product_variants';
    EXECUTE $p$
      CREATE POLICY "product_variants public read"
        ON public.product_variants
        FOR SELECT
        TO anon, authenticated
        USING (true)
    $p$;
  END IF;
END $$;
