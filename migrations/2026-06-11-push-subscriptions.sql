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

-- ─── Trigger pg_net: dispara push em insert de notification ──────────────
-- A URL e o secret saem de `current_setting('app.*')` — setáveis via
--   ALTER DATABASE postgres SET app.push_notify_url = '...';
--   ALTER DATABASE postgres SET app.push_internal_secret = '...';
-- Se algum dos dois estiver NULL/vazio, o trigger só retorna NEW (no-op
-- silencioso), pra não bloquear o insert da notificação em ambientes sem
-- pg_net configurado.
create or replace function dispatch_push_on_notification()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := current_setting('app.push_notify_url', true);
  v_secret text := current_setting('app.push_internal_secret', true);
begin
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
-- Estas duas linhas precisam ser executadas pelo DBA depois do deploy:
--
--   ALTER DATABASE postgres SET app.push_notify_url =
--     'https://queroumacor.com.br/api/push-notify';
--   ALTER DATABASE postgres SET app.push_internal_secret =
--     '<copiar de PUSH_INTERNAL_SECRET no Cloudflare Pages>';
--
-- Após rodar, encerrar e reabrir as conexões pra `current_setting()` ler
-- os novos valores (ou aguardar o pool reciclar). Sem essas duas linhas,
-- o trigger fica em no-op silencioso e nenhum push é enviado — sininho
-- ainda funciona normal.
