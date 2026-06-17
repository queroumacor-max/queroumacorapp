-- ============================================================================
-- RECLASSIFICAÇÃO NÃO-DESTRUTIVA das cores de leque em `products`
-- ----------------------------------------------------------------------------
-- NÃO apaga nenhuma linha. Só:
--   (1) UPDATE — re-prefixa os grupos que ficaram presos em `sw-` pro prefixo
--       correto (tm-/ib-/ral-/rio-/re-/ml-/lk-/np-/l-/p-/q-/x-).
--   (2) UPDATE — "estaciona" (active=false) o Coral duplicado que entrou sob
--       `sw-c-%` (existe a versão certa em `c-c-%`). Reversível: é só voltar
--       active=true se quiser.
--   (3) INSERT — traz de `cores` os grupos que faltam em products (ex: Q, RIO,
--       boa parte do L), com NOT EXISTS pra não duplicar nada.
--
-- Suvinil (s-...) e Sherwin real (sw-sw...) ficam intocados.
--
-- Estado final dos prefixos em products.code:
--   s-...   Suvinil
--   c-...   Coral (correto; a duplicata sob sw- vira active=false)
--   sw-...  Sherwin real (só "SW ...")
--   tm- ib- ral- rio- re- ml- lk- np- l- p- q-   grupos nomeados
--   x-...   Pantone numérico + resto  → aba "Outros"
--
-- Rodar no Supabase SQL Editor (os 3 passos, na ordem). Idempotente.
-- ============================================================================

-- STEP 1 — re-prefixa os grupos presos em sw- (exceto Sherwin real e Coral).
UPDATE public.products
SET code =
  CASE
    WHEN substr(code, 4) ILIKE 'tm%'  THEN 'tm-'  || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'ib%'  THEN 'ib-'  || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'ral%' THEN 'ral-' || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'rio%' THEN 'rio-' || substr(code, 4)
    WHEN substr(code, 4) ILIKE 're%'  THEN 're-'  || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'ml%'  THEN 'ml-'  || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'lk%'  THEN 'lk-'  || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'np%'  THEN 'np-'  || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'l-%'
      OR substr(code, 4) ILIKE 'l %'  THEN 'l-'   || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'p-%'  THEN 'p-'   || substr(code, 4)
    WHEN substr(code, 4) ILIKE 'q%'   THEN 'q-'   || substr(code, 4)
    ELSE 'x-' || substr(code, 4)
  END
WHERE code ILIKE 'sw-%'
  AND code NOT ILIKE 'sw-sw%'   -- mantém Sherwin real
  AND code NOT ILIKE 'sw-c-%';  -- Coral dup tratado no STEP 2

-- STEP 2 — estaciona o Coral duplicado que veio sob sw- (não apaga).
UPDATE public.products
SET active = false
WHERE code ILIKE 'sw-c-%';

-- STEP 3 — traz de `cores` os grupos que ainda faltam em products.
INSERT INTO public.products (id, name, code, color_hex, category, active)
SELECT
  gen_random_uuid(),
  CASE
    WHEN nullif(btrim(src.nome_cor), '') IS NOT NULL
      THEN src.cod || ' - ' || btrim(src.nome_cor)
    ELSE src.cod
  END                                          AS name,
  src.prefix || '-' || lower(btrim(src.cod))   AS code,
  src.color_hex,
  'cores'                                      AS category,
  true                                         AS active
FROM (
  SELECT DISTINCT ON (lower(btrim(c.cod_cor_usuario)))
    c.cod_cor_usuario AS cod,
    c.nome_cor,
    CASE
      WHEN c.r IS NULL OR c.g IS NULL OR c.b IS NULL THEN NULL
      WHEN round(c.r::numeric)::int = 255
       AND round(c.g::numeric)::int = 255
       AND round(c.b::numeric)::int = 255 THEN NULL
      ELSE '#'
        || lpad(to_hex(round(c.r::numeric)::int), 2, '0')
        || lpad(to_hex(round(c.g::numeric)::int), 2, '0')
        || lpad(to_hex(round(c.b::numeric)::int), 2, '0')
    END AS color_hex,
    CASE
      WHEN c.cod_cor_usuario ~* '^SW[ 0-9-]' THEN 'sw'
      WHEN c.cod_cor_usuario ILIKE 'C-%'     THEN 'c'
      WHEN c.cod_cor_usuario ILIKE 'TM%'     THEN 'tm'
      WHEN c.cod_cor_usuario ILIKE 'IB%'     THEN 'ib'
      WHEN c.cod_cor_usuario ILIKE 'RAL%'    THEN 'ral'
      WHEN c.cod_cor_usuario ILIKE 'RIO%'    THEN 'rio'
      WHEN c.cod_cor_usuario ILIKE 'RE%'     THEN 're'
      WHEN c.cod_cor_usuario ILIKE 'ML%'     THEN 'ml'
      WHEN c.cod_cor_usuario ILIKE 'LK%'     THEN 'lk'
      WHEN c.cod_cor_usuario ILIKE 'NP%'     THEN 'np'
      WHEN c.cod_cor_usuario ILIKE 'L-%'
        OR c.cod_cor_usuario ILIKE 'L %'      THEN 'l'
      WHEN c.cod_cor_usuario ILIKE 'P-%'     THEN 'p'
      WHEN c.cod_cor_usuario ILIKE 'Q%'      THEN 'q'
      ELSE 'x'
    END AS prefix
  FROM public.cores c
  WHERE c.flag_excluido = 'N'
    AND c.cod_cor_usuario IS NOT NULL
    AND btrim(c.cod_cor_usuario) <> ''
    AND c.cod_cor_usuario NOT ILIKE 'S-%'   -- Suvinil já está em products
  ORDER BY
    lower(btrim(c.cod_cor_usuario)),
    (nullif(btrim(c.nome_cor), '') IS NULL),
    (c.r IS NULL),
    c.ctid
) src
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.code = src.prefix || '-' || lower(btrim(src.cod))
);

-- ── Verificação (rode separado) ─────────────────────────────────────────────
-- SELECT split_part(code,'-',1) AS grupo, count(*) AS n,
--        count(*) FILTER (WHERE active) AS ativos,
--        count(color_hex) AS com_hex
-- FROM public.products WHERE category='cores'
-- GROUP BY 1 ORDER BY 2 DESC;
--
-- -- aba "Outros" (o que o app mostra): cores, ativas, menos s-/c-/sw-
-- SELECT count(*) AS total_outros FROM public.products
-- WHERE category='cores' AND active
--   AND code NOT ILIKE 's-%' AND code NOT ILIKE 'c-%' AND code NOT ILIKE 'sw-%';
