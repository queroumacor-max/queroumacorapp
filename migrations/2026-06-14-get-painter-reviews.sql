-- 2026-06-14 - RPC get_painter_reviews: avaliacoes de um pintor no perfil publico.
--
-- A tabela reviews e publica pra SELECT, mas nao tem painter_id - liga ao
-- pintor via quote_id => quotes.painter_id. A Wave 27 (B4) fechou o SELECT de
-- quotes (so client_id/painter_id/admin), entao um visitante qualquer nao
-- consegue fazer esse join por conta propria.
--
-- Esta funcao SECURITY DEFINER faz o join server-side e devolve so os campos
-- da avaliacao + nome/avatar de quem avaliou - nunca expoe o PII das quotes
-- (endereco, telefone, valor). Segura pra chamar de qualquer perfil publico.
-- (Comentarios em ASCII puro de proposito: caracteres especiais quebravam o
-- paste no SQL Editor.)

create or replace function public.get_painter_reviews(p_painter_id uuid, p_limit int default 20)
returns table (
  id uuid,
  rating int,
  comment text,
  criteria jsonb,
  created_at timestamptz,
  reviewer_name text,
  reviewer_avatar text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.rating, r.comment, r.criteria, r.created_at,
         pr.name as reviewer_name, pr.avatar_url as reviewer_avatar
  from public.reviews r
  join public.quotes q on q.id = r.quote_id
  left join public.profiles pr on pr.id = r.reviewer_id
  where q.painter_id = p_painter_id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_painter_reviews(uuid, int) to anon, authenticated;
