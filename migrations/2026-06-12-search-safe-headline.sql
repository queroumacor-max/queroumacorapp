-- Wave 31 — Fix CRIT-3 XSS no search.
-- ts_headline default usa <b>/</b> direto no input, sem escapar HTML
-- do bio/caption/description. Trocamos por sentinelas únicas que o
-- frontend reconhece e substitui APÓS escape HTML.
--
-- O frontend (lib/utils/sanitize.ts sanitizeSearchSnippet) é a
-- defesa primária; isso aqui é segunda camada caso alguém esqueça de
-- usar o helper.

create or replace function public.search_all(p_query text, p_limit int default 20)
returns table(
  result_type text,
  id text,
  title text,
  snippet text,
  score real
) language sql stable as $$
  with q as (select plainto_tsquery('portuguese', p_query) as tsq)
  select 'profile' as result_type, p.id::text, p.name as title,
    ts_headline('portuguese', coalesce(p.bio,''), q.tsq,
      'StartSel=⟦HL_OPEN⟧, StopSel=⟦HL_CLOSE⟧, HighlightAll=FALSE, MaxWords=35, MinWords=15, ShortWord=3'
    ) as snippet,
    ts_rank(p.search_vector, q.tsq) as score
  from public.profiles p, q
  where p.search_vector @@ q.tsq
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
