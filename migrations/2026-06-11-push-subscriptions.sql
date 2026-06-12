-- SQL Release C8 (2026-06-11) — Push Notifications (Web Push API + VAPID)
-- ──────────────────────────────────────────────────────────────────────────
-- Motivação: hoje o sininho da bell mostra count de notif em tempo real, mas
-- só quando a aba está aberta. Push Notifications via Web Push API permitem
-- entregar notificações com app fechado / aba inativa / PWA standalone.
--
-- Arquitetura:
--   1) Cliente subscreve via `PushManager.subscribe(applicationServerKey:
--      VAPID public key)` e POSTa o endpoint + chaves p256dh/auth pra
--      tabela `push_subscriptions`.
--   2) Edge route `/api/push-notify` (Cloudflare Pages Functions runtime)
--      recebe `{userIds, title, body, url?, icon?}`, valida secret interno
--      e envia POST encryptado pra cada `endpoint` (com VAPID JWT header).
--   3) Trigger AFTER INSERT em `notifications` chama `net.http_post` (pg_net)
--      pra `/api/push-notify`, propagando todo insert no sininho como push.
--
-- Limitações conhecidas:
--   - iOS: PWA web push só funciona em iOS 16.4+ E quando o app está
--     "Adicionado à Tela Inicial" (modo standalone). Browser Safari direto
--     não recebe.
--   - Endpoints podem expirar (FCM/Mozilla autopush rotacionam); o handler
--     no /api/push-notify deleta subscriptions com response 404/410.

-- ─── Extensão pg_net (necessária pro trigger) ─────────────────────────────
-- Se já estiver habilitada, este CREATE é no-op. Se não, esta linha precisa
-- rodar primeiro (e pode falhar em planos free Supabase muito antigos).
create extension if not exists pg_net with schema extensions;

-- ─── Tabela push_subscriptions ────────────────────────────────────────────
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- User só vê/insere/deleta as próprias subscriptions; o endpoint server-side
-- usa service_role (bypass de RLS) pra ler subscriptions de outros users.
drop policy if exists push_subscriptions_select_own on push_subscriptions;
create policy push_subscriptions_select_own
  on push_subscriptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on push_subscriptions;
create policy push_subscriptions_insert_own
  on push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on push_subscriptions;
create policy push_subscriptions_delete_own
  on push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- Update permitido pro próprio user (pra refresh do `last_seen_at` quando
-- o cliente reconfirma a subscription).
drop policy if exists push_subscriptions_update_own on push_subscriptions;
create policy push_subscriptions_update_own
  on push_subscriptions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── Settings via tabela app_settings (Supabase managed) ─────────────────
-- ALTER DATABASE requer superuser e NÃO funciona no Supabase managed
-- (postgres role do painel não tem permissão — erro 42501). Em vez disso,
-- guardamos os settings numa tabela e a função SECURITY DEFINER lê dela.
-- A tabela é RLS-protegida e só service_role / SECURITY DEFINER functions
-- enxergam — `authenticated` não tem policy de SELECT, então não vaza
-- o secret pro cliente.
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
-- Sem policies pra authenticated/anon — sem leitura possível via PostgREST.
-- service_role bypassa RLS; SECURITY DEFINER functions também (rodam como
-- owner). É o pattern padrão pra "secrets em tabela" no Supabase managed.

-- ─── Trigger pg_net: dispara push em insert de notification ──────────────
-- Lê URL e secret de `app_settings` em vez de current_setting('app.*'),
-- porque ALTER DATABASE não é permitido em Supabase managed.
-- Se algum dos dois estiver ausente, o trigger só retorna NEW (no-op
-- silencioso), pra não bloquear o insert da notificação em ambientes sem
-- pg_net configurado.
create or replace function dispatch_push_on_notification()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_settings where key = 'push_notify_url';
  select value into v_secret from app_settings where key = 'push_internal_secret';
  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object(
      'userIds', jsonb_build_array(new.user_id::text),
      'title', coalesce(new.title, 'QueroUmaCor'),
      'body', coalesce(new.body, ''),
      'url', '/notificacoes'
    )
  );
  return new;
exception when others then
  -- best-effort: erro de rede / pg_net indisponível NÃO deve bloquear o
  -- insert da notification (sininho continua funcionando, só não chega
  -- push).
  return new;
end $$;

drop trigger if exists trg_dispatch_push_notification on notifications;
create trigger trg_dispatch_push_notification
  after insert on notifications
  for each row execute function dispatch_push_on_notification();

-- ─── Settings (rodar UMA VEZ separadamente, fora deste script) ───────────
-- Em vez de ALTER DATABASE (não funciona em Supabase managed), insere/
-- atualiza na tabela app_settings:
--
--   insert into app_settings (key, value) values
--     ('push_notify_url',      'https://queroumacor.com.br/api/push-notify'),
--     ('push_internal_secret', '<copiar de PUSH_INTERNAL_SECRET no CF Pages>')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- Sem essas linhas, o trigger fica em no-op silencioso e nenhum push é
-- enviado — sininho ainda funciona normal.
