-- SQL Wave 29 (2026-06-11) — CSAM scanning + media hash matching (C4)
-- ──────────────────────────────────────────────────────────────────
-- C4 do RELEASE_AUDIT.md. Apple Store + Google Play AGORA exigem CSAM
-- scanning explícito pra apps com UGC (User Generated Content). Esta
-- wave entrega a camada de infraestrutura local:
--
--   1) Coluna `posts.media_hash` (SHA-256 hex) pra rastrear reuploads
--      de conteúdo já moderado/reportado.
--   2) Tabela `media_hash_blocklist` — deny-list interna alimentada
--      por admin (CSAM já reportada, conteúdo abusivo, spam viral).
--   3) Tabela `media_review_queue` — fila de quarentena pra uploads
--      flagados pelo Gemini ou que bateram parcial na blocklist.
--      Não bloqueia upload; só sinaliza pra revisão humana.
--
-- Integração com NCMEC/PhotoDNA fica fora dessa migration (passo
-- manual no Cloudflare Dashboard — ver `docs/CSAM_POLICY.md`).

-- ── (1) media_hash em posts ──────────────────────────────────────
alter table public.posts
  add column if not exists media_hash text;

-- Index pra lookup de reupload (busca por hash exato) e pra dashboard
-- admin agrupar posts pelo mesmo hash. Parcial (WHERE not null) pra
-- não inflar índice com posts sem mídia.
create index if not exists idx_posts_media_hash
  on public.posts(media_hash)
  where media_hash is not null;

-- ── (2) media_hash_blocklist ─────────────────────────────────────
create table if not exists public.media_hash_blocklist (
  id uuid primary key default gen_random_uuid(),
  hash text not null unique,
  category text not null check (category in ('csam','abuse','spam','reported')),
  notes text,
  reported_to_ncmec boolean not null default false,
  ncmec_report_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mhbl_category
  on public.media_hash_blocklist(category);

alter table public.media_hash_blocklist enable row level security;

-- Admin-only (is_portal_admin). Service_role bypassa RLS pra check
-- de uploads pelo endpoint `/api/moderate` enriched.
drop policy if exists mhbl_admin_all on public.media_hash_blocklist;
create policy mhbl_admin_all on public.media_hash_blocklist
  for all to authenticated
  using (public.is_portal_admin())
  with check (public.is_portal_admin());

-- ── (3) media_review_queue ───────────────────────────────────────
create table if not exists public.media_review_queue (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_hash text,
  reason text not null,
  severity text not null check (severity in ('low','med','high','critical')),
  status text not null default 'pending'
    check (status in ('pending','reviewed','dismissed','escalated_ncmec')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_mrq_status_created
  on public.media_review_queue(status, created_at desc);

create index if not exists idx_mrq_user
  on public.media_review_queue(user_id, created_at desc);

alter table public.media_review_queue enable row level security;

-- Admin-only. Inserts vêm via service_role (endpoint /api/moderate
-- chama enqueueMediaReview), updates pelo dashboard admin.
drop policy if exists mrq_admin_all on public.media_review_queue;
create policy mrq_admin_all on public.media_review_queue
  for all to authenticated
  using (public.is_portal_admin())
  with check (public.is_portal_admin());
