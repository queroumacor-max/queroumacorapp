-- 2026-06-14 - busca parcial/prefixo de pessoas (feedback QA).
--
-- Problema: search_all usava so full-text (plainto_tsquery), que casa LEXEMAS
-- inteiros. "ja" nao achava "jackson". O QA pediu que digitar parte do nome
-- ja liste as pessoas.
--
-- Fix: o ramo de PROFILES passa a casar tambem por ILIKE em name/tag/
-- profession (ex.: name ILIKE '%ja%'). Posts/produtos seguem so FTS. Mantem
-- os sentinelas anti-XSS no ts_headline (CRIT-3) intactos.
--
-- ILIKE em alguns milhares de perfis e seq scan barato; se virar gargalo,
-- adicionar indice trigram (pg_trgm) em profiles(name) depois.

create or replace function public.search_all(p_query text, p_limit int default 20)
returns table(
  result_type text,
  id text,
  title text,
  snippet text,
  score real
) language sql stable as $$
  with q as (
    select
      plainto_tsquery('portuguese', p_query) as tsq,
      '%' || replace(replace(p_query, '\', '\\'), '%', '\%') || '%' as ilk
  )
  select 'profile' as result_type, p.id::text, p.name as title,
    ts_headline('portuguese', coalesce(p.bio,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) as snippet,
    greatest(
      ts_rank(p.search_vector, q.tsq),
      case
        when p.name ilike q.ilk or p.tag ilike q.ilk
          or coalesce(p.profession,'') ilike q.ilk then 0.4
        else 0
      end
    ) as score
  from public.profiles p, q
  where p.search_vector @@ q.tsq
     or p.name ilike q.ilk
     or p.tag ilike q.ilk
     or coalesce(p.profession,'') ilike q.ilk
  union all
  select 'post' as result_type, po.id::text, left(coalesce(po.caption,''), 80) as title,
    ts_headline('portuguese', coalesce(po.caption,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) as snippet,
    ts_rank(po.search_vector, q.tsq) as score
  from public.posts po, q
  where po.search_vector @@ q.tsq
    and po.status = 'approved'
  union all
  select 'product' as result_type, pr.id::text, pr.name as title,
    ts_headline('portuguese', coalesce(pr.description,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) as snippet,
    ts_rank(pr.search_vector, q.tsq) as score
  from public.products pr, q
  where pr.search_vector @@ q.tsq
  order by score desc
  limit p_limit;
$$;
