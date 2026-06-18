-- 2026-06-18 - Zera os 2 warnings "Public Can Execute SECURITY DEFINER" de
-- get_painter_reviews, SEM quebrar o perfil publico (anon) e SEM expor PII.
--
-- Contexto: get_painter_reviews era SECURITY DEFINER por UM unico motivo - a
-- tabela reviews nao tinha painter_id, entao ligava ao pintor via
-- quote_id => quotes.painter_id, e a Wave 27 (B4) fechou o SELECT de quotes
-- (PII: endereco/telefone/valor). O DEFINER existia so pra fazer esse join.
--
-- Estrategia: denormaliza painter_id em reviews (backfill + trigger). Com
-- painter_id na propria reviews, o join com quotes some e a funcao vira
-- SECURITY INVOKER lendo so reviews (SELECT publico ja existente desde a Wave 3)
-- + profiles_public (anon). quotes nunca mais e tocada => zero PII e zero
-- warning. O caller (lib/services/reviews.ts) NAO muda: mesma RPC, mesmos args,
-- mesmo shape de retorno.
-- (Comentarios em ASCII puro de proposito: acentos quebravam o paste no editor.)

-- =====================================================================
-- 1) Coluna denormalizada painter_id em reviews
-- =====================================================================
alter table public.reviews
  add column if not exists painter_id uuid
  references public.profiles(id) on delete set null;

-- =====================================================================
-- 2) Backfill a partir das quotes existentes
-- =====================================================================
update public.reviews r
   set painter_id = q.painter_id
  from public.quotes q
 where q.id = r.quote_id
   and r.painter_id is null;

-- =====================================================================
-- 3) Index pro filtro do perfil publico (painter_id + ordenacao por data)
-- =====================================================================
create index if not exists idx_reviews_painter_created
  on public.reviews (painter_id, created_at desc);

-- =====================================================================
-- 4) Trigger pra manter painter_id em novos reviews
-- =====================================================================
-- submit_review (SECURITY DEFINER) insere em reviews sem setar painter_id;
-- este BEFORE INSERT resolve a partir do quote_id. SECURITY DEFINER porque
-- precisa ler quotes (que tem RLS); como trigger, dispara como owner
-- independente de grant. REVOKE EXECUTE fecha o vetor de chamada via RPC.
create or replace function public.set_review_painter_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.painter_id is null and new.quote_id is not null then
    select q.painter_id into new.painter_id
      from public.quotes q
     where q.id = new.quote_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_review_painter_id() from public, anon, authenticated;

drop trigger if exists trg_set_review_painter_id on public.reviews;
create trigger trg_set_review_painter_id
  before insert on public.reviews
  for each row execute function public.set_review_painter_id();

-- =====================================================================
-- 5) Garante SELECT publico em reviews (idempotente, defesa em profundidade)
-- =====================================================================
-- A Wave 3 ja restaurou o SELECT publico de reviews; recriamos por nome pra
-- garantir que o INVOKER funcione pra anon mesmo se o nome divergir. Nenhuma
-- coluna de reviews e PII (id/quote_id/reviewer_id sao UUIDs).
drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews
  for select to anon, authenticated using (true);

-- =====================================================================
-- 6) Recria get_painter_reviews como SECURITY INVOKER (sem join em quotes)
-- =====================================================================
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
security invoker
set search_path = public
as $$
  select r.id, r.rating, r.comment, r.criteria, r.created_at,
         pr.name as reviewer_name, pr.avatar_url as reviewer_avatar
  from public.reviews r
  left join public.profiles_public pr on pr.id = r.reviewer_id
  where r.painter_id = p_painter_id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_painter_reviews(uuid, int) to anon, authenticated;
