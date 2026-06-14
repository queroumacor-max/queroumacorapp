-- 2026-06-14 — RPC get_painter_reviews: avaliações de um pintor no perfil público.
--
-- A tabela `reviews` é pública pra SELECT, MAS não tem `painter_id` — ela liga
-- ao pintor via `quote_id → quotes.painter_id`. A Wave 27 (B4) fechou o SELECT
-- de `quotes` (só client_id/painter_id/admin), então um visitante qualquer NÃO
-- consegue fazer esse join por conta própria.
--
-- Esta função SECURITY DEFINER faz o join server-side e devolve SÓ os campos
-- da avaliação + nome/avatar de quem avaliou — nunca expõe o PII das quotes
-- (endereço, telefone, valor). Segura pra chamar de qualquer perfil público.

create or replace function public.get_painter_reviews(
  p_painter_id uuid,
  p_limit int default 20
)
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
  select
    r.id,
    r.rating,
    r.comment,
    r.criteria,
    r.created_at,
    pr.name       as reviewer_name,
    pr.avatar_url as reviewer_avatar
  from public.reviews r
  join public.quotes q   on q.id = r.quote_id
  left join public.profiles pr on pr.id = r.reviewer_id
  where q.painter_id = p_painter_id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_painter_reviews(uuid, int) to anon, authenticated;
