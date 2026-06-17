-- ============================================================================
-- Migração: cores Coral (tabela `cores`) → `products`
-- ----------------------------------------------------------------------------
-- Espelha o import Suvinil/Sherwin: cada cor do leque vira uma linha em
-- `products`, identificada pelo prefixo de código que o app usa pra montar o
-- seletor de tintometria (fetchLequeColors → ilike 'c-%').
--
-- NÃO altera schema. Só faz INSERT idempotente (seguro reapertar — o NOT EXISTS
-- evita duplicar).
--
-- Rodar no Supabase SQL Editor.
--
-- OBS: os códigos Coral em `cores` já começam com "C-" (ex: "C-00BB 06/017").
-- Como o spec pede code = 'c-' || lower(trim(cod_cor_usuario)), o valor gravado
-- fica com prefixo duplo ("c-c-00bb 06/017"). Isso é só roteamento interno do
-- leque; o app esconde UM 'c-' via displayCode() e exibe o código real
-- ("C-00BB 06/017"). O `name` usa o cod_cor_usuario cru, sem duplicar.
--
-- Mapeamento:
--   code      = 'c-' || lower(trim(cod_cor_usuario))
--   name      = "COD - NOME" quando tem nome, senão só "COD"
--   color_hex = '#rrggbb' do RGB; NULL quando branco puro (255/255/255) ou
--               RGB incompleto
--   category  = 'cores'
--   active    = true
--
-- Dedup: DISTINCT ON (lower(trim(cod_cor_usuario))) mantém UMA linha por
-- código, preferindo a que tem nome E tem RGB.
-- ============================================================================

INSERT INTO public.products (id, name, code, color_hex, category, active)
SELECT
  gen_random_uuid(),
  CASE
    WHEN nullif(btrim(src.nome_cor), '') IS NOT NULL
      THEN src.cod_cor_usuario || ' - ' || btrim(src.nome_cor)
    ELSE src.cod_cor_usuario
  END                                          AS name,
  'c-' || lower(btrim(src.cod_cor_usuario))    AS code,
  src.color_hex,
  'cores'                                      AS category,
  true                                         AS active
FROM (
  SELECT DISTINCT ON (lower(btrim(c.cod_cor_usuario)))
    c.cod_cor_usuario,
    c.nome_cor,
    -- hex do RGB; NULL quando branco puro (255/255/255) ou RGB ausente.
    -- round(...::numeric) tolera valores guardados como texto "255" / "255.0".
    CASE
      WHEN c.r IS NULL OR c.g IS NULL OR c.b IS NULL THEN NULL
      WHEN round(c.r::numeric)::int = 255
       AND round(c.g::numeric)::int = 255
       AND round(c.b::numeric)::int = 255 THEN NULL
      ELSE '#'
        || lpad(to_hex(round(c.r::numeric)::int), 2, '0')
        || lpad(to_hex(round(c.g::numeric)::int), 2, '0')
        || lpad(to_hex(round(c.b::numeric)::int), 2, '0')
    END AS color_hex
  FROM public.cores c
  WHERE c.flag_excluido = 'N'
    AND c.cod_cor_usuario ILIKE 'C-%'
  ORDER BY
    lower(btrim(c.cod_cor_usuario)),
    (nullif(btrim(c.nome_cor), '') IS NULL),  -- linhas COM nome primeiro
    (c.r IS NULL),                            -- linhas COM rgb primeiro
    c.ctid
) src
-- Não reimporta cor que já tem produto: nem a versão crua nem a versão c-
-- (idempotência em re-runs).
WHERE NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.code = src.cod_cor_usuario
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.code = 'c-' || lower(btrim(src.cod_cor_usuario))
      );

-- ── Verificação (rode separado pra conferir o resultado) ────────────────────
-- SELECT count(*)                                   AS total_coral,
--        count(color_hex)                           AS com_hex,
--        count(*) FILTER (WHERE color_hex IS NULL)  AS sem_hex
-- FROM public.products
-- WHERE code ILIKE 'c-%';
--
-- SELECT code, name, color_hex
-- FROM public.products
-- WHERE code ILIKE 'c-%'
-- ORDER BY code
-- LIMIT 30;
