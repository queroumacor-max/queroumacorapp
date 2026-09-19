-- ════════════════════════════════════════════════════════════════════
-- DR/Business-Continuity audit (2026-09-17) — 2 correções de código no
-- banco, as únicas deste audit que exigem SQL. Ver
-- docs/DR_RUNBOOK.md e docs/DR_AUDIT_2026-09-17.md pro relatório
-- completo (achados que NÃO exigem SQL — CI/CD, secrets, mobile
-- signing, storage buckets criados só via UI — ficam só documentados
-- lá, não têm ação de banco).
--
-- Idempotente (roda 2x sem erro), como toda migration deste repo.
--
-- PARTE 1 — `deletion_tombstones`: ledger append-only de exclusões de
-- conta. Não resolve sozinho o problema de fundo (ver nota abaixo —
-- um PITR restore rola a tabela pra trás JUNTO com o resto do banco),
-- mas fecha uma lacuna concreta: hoje o ÚNICO registro de "quando essa
-- conta foi excluída" é uma linha em `audit_log`, que qualquer
-- `service_role` (ou um bug de aplicação) pode UPDATE/DELETE. Esta
-- tabela não tem NENHUMA policy de UPDATE/DELETE — nem pra admin —
-- então em uso normal da API (anon/authenticated/portal admin) é
-- fisicamente impossível apagar ou alterar uma linha depois de
-- gravada. `service_role` ainda ignora RLS por definição do Postgres
-- (é role de superusuário da API) — isso é limite conhecido do
-- Supabase, não bug desta tabela.
--
-- LIMITE HONESTO (documentado pra não vender proteção que não existe):
-- um PITR restore do Postgres restaura ESTA tabela junto com todas as
-- outras — ela não sobrevive sozinha a um "voltar o relógio" do banco
-- inteiro. Pra isso valer de verdade como defesa contra
-- "restore antigo ressuscita conta deletada", o evento também precisa
-- ir pra um sistema FORA do Postgres (a auditoria propôs logar em
-- Sentry, que já está integrado — ver app/api/delete-account/route.ts
-- e app/api/admin/users/route.ts nesta mesma leva de mudanças). Esta
-- tabela serve de fonte estruturada pra essa reconciliação (é o que
-- se compara contra o Sentry/backup externo depois de um restore),
-- não de blindagem sozinha.
--
-- PARTE 2 — `dr_integrity_report()`: função de diagnóstico read-only
-- (não corrige nada sozinha) pra rodar LOGO APÓS qualquer restore —
-- ou periodicamente, como health check de integridade. Cobre parte do
-- item "200. INTEGRITY CHECKS" do audit: referências quebradas
-- DB→Storage (posts/perfil/produtos apontando pra arquivo que não
-- existe mais no bucket — a auditoria confirmou que HOJE não existe
-- NENHUMA checagem nessa direção; só a oposta, Storage→DB, via
-- `cleanup_orphan_media()`), RLS ligada nas tabelas-base, e duplicidade
-- na blocklist de hash CSAM.
-- ════════════════════════════════════════════════════════════════════

-- ── PARTE 1: deletion_tombstones ──────────────────────────────────

create table if not exists public.deletion_tombstones (
  id bigserial primary key,
  entity_type text not null check (entity_type in ('user', 'post', 'media_hash')),
  entity_id text not null,
  deleted_by uuid,
  reason text,
  source text not null default 'app',
  created_at timestamptz not null default now()
);

comment on table public.deletion_tombstones is
  'Ledger append-only (sem policy de UPDATE/DELETE) de exclusões. '
  'Usado na reconciliação pós-restore: comparar contra este ledger + '
  'o registro externo (Sentry) pra saber o que precisa ser re-excluído '
  'depois de um PITR restore que ressuscitou dados antigos. Não '
  'sobrevive sozinho a um restore do banco inteiro — ver comentário no '
  'topo do arquivo de migration.';

create index if not exists idx_deletion_tombstones_entity
  on public.deletion_tombstones(entity_type, entity_id);
create index if not exists idx_deletion_tombstones_created
  on public.deletion_tombstones(created_at desc);

alter table public.deletion_tombstones enable row level security;

-- Só leitura pra admin do portal. DE PROPÓSITO sem nenhuma policy de
-- INSERT/UPDATE/DELETE pra authenticated/anon/admin — a única escrita
-- válida é via SECURITY DEFINER (admin_delete_user, abaixo) ou
-- service_role (rotas server-side), nunca direto pela API por ninguém
-- logado. Isso é o que torna a tabela "append-only" de fato, não só
-- de nome.
drop policy if exists deletion_tombstones_admin_select on public.deletion_tombstones;
create policy deletion_tombstones_admin_select on public.deletion_tombstones
  for select
  using ((select public.is_portal_admin()));

-- ── PARTE 1b: admin_delete_user grava tombstone ANTES do delete ────
--
-- Mesma assinatura/guardas da versão vigente
-- (migrations/2026-08-28-delete-user-fk-sweep.sql). Único acréscimo:
-- INSERT em deletion_tombstones logo depois do INSERT em audit_log,
-- antes do DELETE em auth.users. Se um dia a função for recriada de
-- novo por outra migration, ela HERDA esse INSERT só se quem escrever
-- a próxima versão copiar este bloco — não há trigger automático
-- porque auth.users não é gerenciável por trigger nosso.

create or replace function public.admin_delete_user(p_user_id uuid, p_force_admin boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller     uuid := auth.uid();
  v_target     jsonb;
  v_had_auth    boolean := false;
  v_had_profile boolean := false;
begin
  if v_caller is null then
    raise exception 'Faça login para excluir contas';
  end if;
  if not public.is_portal_admin() then
    raise exception 'não autorizado (precisa de acesso ao portal)';
  end if;
  if p_user_id is null then
    raise exception 'userId obrigatório';
  end if;
  if p_user_id = v_caller then
    raise exception 'você não pode excluir a própria conta por aqui';
  end if;

  select to_jsonb(p) into v_target from public.profiles p where p.id = p_user_id;

  if v_target is not null and not p_force_admin and (
       coalesce((v_target->>'portal_access')::boolean, false)
    or coalesce(v_target->>'role', '') = 'admin'
    or coalesce((v_target->>'is_admin')::boolean, false)
  ) then
    raise exception 'este perfil tem acesso admin/portal — revogue o acesso antes de excluir (ou confirme force_admin)';
  end if;

  insert into public.audit_log (actor_id, action, target_table, target_id, changes)
  values (
    v_caller, 'admin.user.delete_user', 'profiles', p_user_id::text,
    jsonb_build_object(
      'deleted', true, 'via', 'rpc admin_delete_user',
      'target_name', v_target->>'name', 'target_tag', v_target->>'tag',
      'force_admin', p_force_admin
    )
  );

  -- DR audit 2026-09-17: tombstone imutável, complementa audit_log (que
  -- pode ser UPDATE/DELETE por service_role, e que também rola de volta
  -- inteiro num PITR restore — a defesa de verdade contra restore é o
  -- espelho externo em Sentry feito pelo caller HTTP, não esta linha
  -- sozinha).
  insert into public.deletion_tombstones (entity_type, entity_id, deleted_by, reason, source)
  values ('user', p_user_id::text, v_caller, 'admin_delete_user rpc', 'rpc');

  delete from auth.users where id = p_user_id;
  v_had_auth := found;
  delete from public.profiles where id = p_user_id;
  v_had_profile := found;

  if not v_had_auth and not v_had_profile and v_target is null then
    raise exception 'usuário não encontrado (id %)', p_user_id;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'had_auth_user', v_had_auth,
    'had_profile', v_had_profile
  );
end;
$$;

revoke all on function public.admin_delete_user(uuid, boolean) from public, anon;
grant execute on function public.admin_delete_user(uuid, boolean) to authenticated;

-- ── PARTE 2: dr_integrity_report() ─────────────────────────────────
--
-- Read-only. Não apaga nada, não conserta nada — só relata. Rodar:
--   select * from public.dr_integrity_report();
-- Uso pretendido: (a) logo após qualquer restore de banco, ANTES de
-- rodar `execute_cleanup_orphan_media()` (ver aviso em
-- docs/RUNBOOK.md); (b) como checagem periódica de saúde, independente
-- de restore.

create or replace function public.dr_integrity_report()
returns table(check_name text, status text, detail text)
language plpgsql security definer set search_path = public as $$
declare
  v_count bigint;
begin
  if not public.is_portal_admin() then
    raise exception 'não autorizado (precisa de acesso ao portal)';
  end if;

  -- 1) RLS ligada em toda tabela base de public (exclui views).
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  return query select
    'rls_enabled_on_all_tables'::text,
    case when v_count = 0 then 'ok' else 'fail' end,
    v_count || ' tabela(s) em public sem RLS habilitada';

  -- 2) posts.media_url apontando pra objeto que não existe mais no
  -- bucket `posts` (reconciliação Storage↔DB — direção que
  -- cleanup_orphan_media() NÃO cobre; ele só olha o sentido oposto).
  select count(*) into v_count
  from public.posts p
  where p.deleted_at is null
    and p.media_url is not null
    and p.media_url like '%/storage/v1/object/%/posts/%'
    and not exists (
      select 1 from storage.objects so
      where so.bucket_id = 'posts'
        and so.name = regexp_replace(
          regexp_replace(p.media_url, '^.*/storage/v1/object/(?:public/|sign/)?posts/', ''),
          '\?.*$', ''
        )
    );
  return query select
    'posts_media_url_missing_from_storage'::text,
    case when v_count = 0 then 'ok' else 'warn' end,
    v_count || ' post(s) com media_url apontando pra objeto ausente no bucket posts';

  -- 3) profiles.avatar_url apontando pra objeto ausente no bucket
  -- `avatars`.
  select count(*) into v_count
  from public.profiles pr
  where pr.avatar_url is not null
    and pr.avatar_url like '%/storage/v1/object/%/avatars/%'
    and not exists (
      select 1 from storage.objects so
      where so.bucket_id = 'avatars'
        and so.name = regexp_replace(
          regexp_replace(pr.avatar_url, '^.*/storage/v1/object/(?:public/|sign/)?avatars/', ''),
          '\?.*$', ''
        )
    );
  return query select
    'profiles_avatar_url_missing_from_storage'::text,
    case when v_count = 0 then 'ok' else 'warn' end,
    v_count || ' perfil(s) com avatar_url apontando pra objeto ausente no bucket avatars';

  -- 4) media_hash_blocklist: hash duplicado (a UNIQUE deveria impedir
  -- isso sempre — se aparecer, é sinal de restore parcial/replay
  -- estranho ou de a UNIQUE ter sido removida em algum momento).
  select count(*) into v_count
  from (
    select hash from public.media_hash_blocklist group by hash having count(*) > 1
  ) dup;
  return query select
    'media_hash_blocklist_no_duplicates'::text,
    case when v_count = 0 then 'ok' else 'fail' end,
    v_count || ' hash(es) duplicado(s) em media_hash_blocklist (não deveria ser possível com a UNIQUE)';

  -- 5) profiles sem auth.users correspondente (não deveria existir —
  -- profiles.id é FK pra auth.users — mas um restore/replay parcial
  -- de migrations pode ter deixado linha órfã antes da FK existir).
  select count(*) into v_count
  from public.profiles pr
  where not exists (select 1 from auth.users au where au.id = pr.id);
  return query select
    'profiles_without_auth_user'::text,
    case when v_count = 0 then 'ok' else 'fail' end,
    v_count || ' perfil(is) sem auth.users correspondente';

  -- 6) push_device_tokens/push_subscriptions com user_id que não
  -- existe mais em profiles (deveria ser impossível via
  -- ON DELETE CASCADE; sinal de restore parcial se aparecer).
  select count(*) into v_count
  from public.push_device_tokens t
  where not exists (select 1 from public.profiles pr where pr.id = t.user_id);
  return query select
    'push_device_tokens_orphaned'::text,
    case when v_count = 0 then 'ok' else 'warn' end,
    v_count || ' token(s) de push nativo com user_id órfão';

  return;
end;
$$;

revoke all on function public.dr_integrity_report() from public, anon, authenticated;
grant execute on function public.dr_integrity_report() to authenticated;

-- ── Conferência (rode depois de aplicar) ───────────────────────────
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='deletion_tombstones';
-- select relrowsecurity from pg_class where relname='deletion_tombstones';
-- select proname from pg_proc where proname in ('admin_delete_user','dr_integrity_report');
-- -- (como postgres/service_role no SQL Editor, is_portal_admin() sempre
-- -- dá false — não dá pra chamar dr_integrity_report() de lá pra testar
-- -- de verdade; testar logado como admin no portal.)
