# DATABASE.md — Schema do QueroUmaCor

Source of truth: [`supabase_init.sql`](./supabase_init.sql). Quando houver
divergência, o SQL ganha.

## 1. Visão geral

- **Backend:** Supabase Postgres (projeto `uwqebaqweehiljsqkifm`). Plano
  **PRO** ($25/mês) — 8 GB DB, 100 GB storage, 50 GB bandwidth, PITR 7d.
- **RLS:** habilitado em **todas** as tabelas de `public`. Policies são
  idempotentes (`DROP POLICY IF EXISTS` + recreate).
- **Defense in depth:** RLS no banco + `WHERE auth.uid()` no client (via
  `db.js`) + validações nas RPCs `SECURITY DEFINER`.
- **Realtime:** `messages`, `notifications`, `quotes` publicados em
  `supabase_realtime`. `messages` tem `REPLICA IDENTITY FULL`.
- **Extensões:** `pgcrypto` (`gen_random_uuid`), `pg_cron` (não agendada
  ainda — `cleanup_*` aguardam).

---

## 2. Lista de tabelas

| Tabela | Descrição |
|---|---|
| `profiles` | Espelho de `auth.users` com perfil, PRO, role, geo, consentimento LGPD. |
| `posts` | Feed social (fotos/vídeos/serviços à venda). Pré-existente — sem `CREATE TABLE` no init.sql. |
| `follows` | Grafo de seguidores. `UNIQUE(follower_id, following_id)`. |
| `likes` | Curtidas em posts. `UNIQUE(user_id, post_id)`. |
| `comments` | Comentários em posts. |
| `saved_posts` | Bookmarks privados. |
| `messages` | DMs 1-a-1 + grupos 3-way (chat com loja). |
| `orders` | Pedidos da loja Cali Colors (integração InfinitePay/MP). |
| `quotes` | Orçamentos (`pending → rascunho → enviado → aprovado → em_execucao → concluido`). |
| `jobs` | Agenda do pintor. |
| `reviews` | Avaliações 1-5 atreladas a `quote_id`. |
| `products` | Catálogo da loja. |
| `points` | Cashback (`earned`/`redeemed`). |
| `referrals` | Indicações pintor-a-pintor. `UNIQUE(referrer_id, referred_id)`. |
| `notifications` | Sininho in-app (realtime). |
| `notes` | Anotações do usuário. |
| `checklists` | Listas de tarefas por obra/orçamento. |
| `reports` | Denúncias. |
| `feature_interest` | Cliques em "Em breve" pra medir interesse. |
| `announcements` | Avisos do portal. |
| `commissions` | Comissões por job/quote. |
| `auto_responses` | Templates de resposta automática. |
| `follow_ups` | Follow-ups agendados de orçamento. |
| `qualifications` | Formações do perfil profissional. |
| `courses` | Cursos publicados pelo profissional. |
| `rate_limits` | Janela de rate limiting (deny-all em RLS, consultada por RPC). |
| `audit_events` | Log de auditoria (PRO change, order status, pontos suspeitos). |
| `account_deletion_requests` | Pedidos LGPD Art. 18 VI (SLA 15d). |
| `errors` | Logs do client via `/api/log-error`. Fora do init.sql. |

---

## 3. Tabelas centrais

### 3.1 `profiles`

PK `id uuid REFERENCES auth.users(id) ON DELETE CASCADE`. Auto-criado por
`handle_new_user()` no signup.

Colunas: `name`, `avatar_url`, `email`, `tag`, `username`, `profession`
(default `pintor`), `role`, `user_type` (CHECK em
`cliente|pintor|grafiteiro|automotivo|funileiro|admin`), `city`, `state`,
`phone`, `specialties`, `rating_avg`, `review_count`, `lat`, `lng`,
`invited_by`, `invite_code_used`, `portal_access`, `is_pro`,
`pro_expires_at`, `mp_preapproval_id`, `business_logo_url`,
`business_name`, `service_radius`, `archived_conversations`, `cart`,
`ai_logo_gen_count`, `seen_stories`, `consent_at`, `consent_version`,
`birth_date`. CHECK `profiles_avatar_url_scheme` força `https://` ou
`data:image/*;base64`.

**RLS:** SELECT público (preferir view `profiles_public`); UPDATE/INSERT
do próprio (`auth.uid() = id`); `Portal admins can update any profile`
via `is_portal_admin()` (SECURITY DEFINER, evita recursão 42P17).

**Triggers:**
- `on_auth_user_created` em `auth.users` → `handle_new_user()` cria
  profile mínimo, allowlist de `user_type`, nunca propaga erro.
- `protect_profile_columns` BEFORE INSERT OR UPDATE → bloqueia escalada
  de `is_pro`/`portal_access`/`role=admin` (bypass por `service_role` e
  portal admin).
- `trg_audit_profile_changes` AFTER UPDATE → grava `audit_events`.
- `sync_profile_tag_username` BEFORE INSERT/UPDATE — mantém `tag` e
  `username` sincronizados (aplicado fora do init.sql).

---

### 3.2 `posts`

Pré-existente. Colunas garantidas: `status` (default `approved`),
`for_sale`, `price`, `art_type`. FK `posts.user_id → profiles.id`. CHECK
`posts_image_url_scheme` (`https://` ou `data:image/*;base64`).

**RLS:** SELECT público; INSERT do próprio user;
`posts_owner_update`/`posts_owner_delete` (dono OU `is_portal_admin()`).

**Índices:** `idx_posts_user_created`, `idx_posts_status_created`,
`idx_posts_mediatype_created`.

---

### 3.3 `follows`

`id`, `follower_id`, `following_id`, `created_at`. `UNIQUE(follower_id,
following_id)` + CHECK `follows_no_self`.

**RLS:** `follows_select_auth` (authenticated, sem anon enumerar);
`Users can manage own follows` (`auth.uid() = follower_id`).

**Índices:** `idx_follows_follower`, `idx_follows_following`.

---

### 3.4 `likes`

`id`, `user_id`, `post_id`, `created_at`. `UNIQUE(user_id, post_id)`.

**RLS:** `likes_select_auth`; `Users can manage own likes`
(`auth.uid() = user_id`). **Índices:** `idx_likes_post`, `idx_likes_user`.

---

### 3.5 `comments`

`id`, `post_id`, `user_id`, `text`, `created_at`.

**RLS:** `comments_select_auth`; INSERT só do próprio; DELETE pelo autor
OU pelo dono do post. **Índices:** `idx_comments_post_id`.

---

### 3.6 `messages`

`id`, `sender_id`, `receiver_id`, `conversation_id`, `content`, `type`
(default `text`), `created_at`.

**RLS:** participantes leem (sender OR receiver); INSERT só se
`auth.uid() = sender_id`; portal admin lê tudo (chats 3-way).

`REPLICA IDENTITY FULL` + publicado em `supabase_realtime`. RPC
`get_conversations()` agrega no servidor.

**Índices:** `idx_messages_conversation_id`, `idx_messages_sender_id`,
`idx_messages_receiver_id`, `idx_messages_sender_created`,
`idx_messages_receiver_created`.

---

### 3.7 `orders`

`id`, `user_id`, `items jsonb`, `total`, `status` (CHECK
`pending|paid|amount_mismatch|refunded|canceled`), `gateway`,
`payment_url`, `tx_id`, `paid_amount`, `paid_at`, `payment_method`,
`installments`, `receipt_url`, `created_at`.

**RLS:** dono lê os próprios; admin lê/altera tudo
(`orders_admin_view`/`orders_admin_update`); webhook escreve via
`service_role`.

**Índices:** `idx_orders_tx_id`, `idx_orders_tx_unique` (UNIQUE parcial,
anti-replay).

**Triggers:**
- `trg_award_order_paid_points` → `FLOOR(LEAST(total, paid_amount)/10)`,
  cap 100 pts/order, dedup por `(source='order_paid', reference_id)`.
- `trg_audit_order_changes` → grava `audit_events` em
  `paid|refunded|canceled|amount_mismatch`.

---

### 3.8 `quotes`

Ciclo: `pending → rascunho → enviado → aprovado → em_execucao →
concluido` (+ `recusado`); aceita legados `accepted|completed|rejected`.

Colunas: `id`, `client_id`, `painter_id`, `title`, `service_type`,
`area_m2`, `address`, `description`, `proposed_date`, `price`, `status`,
`lead_type` (default `shared`), `is_exclusive`, `commission_pct`,
`client_name`, `client_phone`, `sent_at`, `approved_at`, `approved_by`,
`approval_method`, `completed_at`, `scope_snapshot jsonb`,
`client_followup_optin`, `quote_data jsonb`, `images jsonb`.

**RLS:** `quotes_own_read` (client OR painter OR portal admin). SELECT
público removido. INSERT via RPC `create_quote_from_post()` /
`create_painter_draft()`.

**Índices:** `idx_quotes_client_id`, `idx_quotes_painter_id`,
`idx_quotes_status`.

**Triggers:**
- `trg_award_quote_request_points` AFTER INSERT → +5 pts pro client.
- `trg_award_quote_completed_points` AFTER UPDATE → +15 pts pro painter
  ao concluir, só se veio de aprovado/em_execucao/accepted/completed
  (anti farming).

Publicado em `supabase_realtime`.

---

### 3.9 `jobs`

`id`, `painter_id`, `quote_id`, `client_name`, `service_type`,
`address`, `scheduled_date`, `scheduled_time`, `status` (default
`agendado`), `notes`, `revenue`, `material_cost`, `created_at`.

**RLS:** `Users can manage own jobs` (`auth.uid() = painter_id`).
**Índices:** `idx_jobs_painter_id`, `idx_jobs_scheduled_date`.

---

### 3.10 `reviews`

`id`, `reviewer_id`, `quote_id`, `rating integer`, `criteria jsonb`,
`comment`, `created_at`. CHECK `reviews_rating_range` (1-5).

**RLS:** `reviews_select_public`. INSERT só via RPC `submit_review()` —
valida ownership do quote, anti-duplicata, `rating ∈ [1,5]`. Trigger
`recalc_painter_rating` atualiza `profiles.rating_avg`/`review_count`
(fora do init.sql). **Índices:** `idx_reviews_reviewer`.

---

### 3.11 `products`

`id`, `name`, `code`, `category`, `volume`, `price`, `color_hex`,
`color_gradient`, `stock`, `badge`, `description`, `line`, `rendimento`,
`demaos`, `secagem`, `active`, `created_at`, `image_url`.

**RLS:** SELECT público; INSERT/UPDATE/DELETE só por
`is_portal_admin()` (`products_admin_insert/update/delete`).

---

### 3.12 `points`

`id`, `user_id`, `amount integer` (CHECK `0..10000`), `type`
(`earned|redeemed`), `source`, `reference_id`, `created_at`.
`UNIQUE INDEX idx_points_source_ref` em `(source, reference_id) WHERE
reference_id IS NOT NULL` — anti double-credit.

**RLS:** `Users can view own points`. **Sem INSERT direto** — só por
triggers `award_*` ou RPC `redeem_pro_with_points()` (hardcode 100,
`pg_advisory_xact_lock`). `trg_audit_points_insert` loga `redeemed` ou
`source` fora da allowlist.

---

### 3.13 `referrals`

`id`, `referrer_id`, `referred_id`, `quote_id`, `status`,
`bonus_points`, `created_at`. `UNIQUE(referrer_id, referred_id)`.

**RLS:** SELECT pra referrer ou referred; `referrals_referred_insert` —
só o `referred_id` insere com `referrer_id IS NOT NULL AND
referrer_id <> auth.uid()`. Trigger `award_referral_points` credita
pontos (fora do init.sql).

---

### 3.14 `notifications`

`id`, `user_id`, `actor_id`, `type`, `title`, `body`, `ref_id`, `read`,
`created_at`.

**RLS:** SELECT/UPDATE do próprio. INSERT direto bloqueado — só via RPC
`notify_user()`, que exige relacionamento prévio (quote/conversa) ou
admin. Publicado em `supabase_realtime`.

---

### 3.15 `errors`

Logs do client via `/api/log-error`. Não está em `supabase_init.sql`
(criada à parte). Convive com Sentry (integrado ao GitHub do projeto).
Dashboard em `/admin/errors`.

---

### 3.16 `reports`

`id`, `reporter_id` (NOT NULL), `post_id`, `target_user_id`, `reason`,
`status` (CHECK `pending|reviewed|resolved|dismissed`), `created_at`.

**RLS:** INSERT pelo próprio reporter; SELECT só dos próprios. UNIQUE
parcial `(reporter_id, post_id)` evita spam.

---

### 3.17 `checklists`

`id`, `user_id`, `quote_id`, `title`, `items jsonb`, `created_at`.
**RLS:** `Users can manage own checklists`.

---

### 3.18 `notes`

`id`, `user_id`, `body`, `created_at`. **RLS:** `Users can manage own
notes`.

---

## 4. Views

### `profiles_public` (`security_invoker = true`)

Projeção segura de `profiles`. Omite `email`, `phone`, `lat`, `lng`,
`mp_preapproval_id`, `invited_by`, `invite_code_used`, `cart`,
`pro_expires_at`, etc. Colunas expostas: `id`, `name`, `avatar_url`,
`bio`, `tag`, `username` (via `coalesce(username, tag)`), `role`,
`user_type`, `profession`, `specialties`, `palette`, `city`, `state`,
`country`, `is_pro`, `verified`, `rating_avg`, `review_count`,
`service_radius`, `created_at`, `portal_access`.

Cliente deve usar essa view pra busca, feed, perfis de terceiros. O
profile completo só pro dono ou admin.

GRANT SELECT pra `anon` e `authenticated`.

### `announcements_public` (`security_invoker = true`)

Omite `created_by`. Colunas: `id`, `title`, `message`, `active`,
`created_at`.

---

## 5. Functions / triggers customizados

| Função | Propósito |
|---|---|
| `is_portal_admin()` | Boolean stable SECURITY DEFINER — evita recursão 42P17 em policies de `profiles`. |
| `handle_new_user()` | Trigger AFTER INSERT em `auth.users` — cria profile mínimo, allowlist de `user_type`, jamais propaga erro. |
| `protect_profile_columns()` | Trigger BEFORE INSERT OR UPDATE em `profiles` — bloqueia escalada de `is_pro`/`portal_access`/`role=admin`. |
| `get_conversations()` | RPC SECURITY DEFINER — agrega últimas mensagens por conversa, com flag `is3way`. |
| `create_quote_from_post(...)` | RPC — força `client_id = auth.uid()`, valida que painter ≠ self. |
| `create_painter_draft(...)` | RPC — cria quote em status `rascunho` com `painter_id = auth.uid()`. |
| `submit_review(...)` | RPC — valida quote ownership + rating 1-5 + anti-duplicata. |
| `redeem_pro_with_points(...)` | RPC — débito atômico de 100 pts e ativação de PRO por 30 dias. `p_cost` é IGNORADO (hardcode 100). Usa `pg_advisory_xact_lock`. |
| `notify_user(...)` | RPC — exige relação prévia (quote/conversa) ou admin pra inserir notification. |
| `award_quote_request_points()` | Trigger AFTER INSERT em `quotes` — +5 pts pro client. |
| `award_quote_completed_points()` | Trigger AFTER UPDATE em `quotes` — +15 pts pro painter ao concluir, só se veio de status aprovado. |
| `award_order_paid_points()` | Trigger AFTER UPDATE em `orders` — `FLOOR(LEAST(total, paid_amount)/10)`, cap 100. |
| `check_rate_limit(...)` | RPC `service_role` — bump `rate_limits` e retorna `{allowed, count, retry_after_seconds}`. |
| `cleanup_rate_limits()` | Cleanup — apaga windows > 1h. |
| `cleanup_old_notifications()` | Apaga notifications > 90 dias. |
| `cleanup_old_audit_events()` | LGPD: retenção 1 ano. |
| `cleanup_old_messages()` | LGPD: retenção 2 anos. |
| `cleanup_old_quotes()` | Apaga quotes concluídos > 3 anos. |
| `audit_profile_changes()` / `audit_order_changes()` / `audit_points_insert()` | Triggers de auditoria → `audit_events`. |
| `audit_log_manual(...)` | RPC pra admin gravar evento manual. |
| `request_account_deletion(p_reason)` | RPC LGPD — upsert em `account_deletion_requests` + audit. |
| `award_referral_points()` / `recalc_painter_rating()` / `sync_profile_tag_username()` | Definidos fora do `supabase_init.sql`, já aplicados no banco (ver CLAUDE.md). |

Cleanup jobs aguardam `pg_cron` (sugestão comentada no SQL):
```sql
SELECT cron.schedule('cleanup_notifications', '0 3 * * 0', 'SELECT public.cleanup_old_notifications()');
SELECT cron.schedule('cleanup_audit',         '0 4 * * 0', 'SELECT public.cleanup_old_audit_events()');
```

---

## 6. Storage buckets

| Bucket | Público? | Limite | MIME | Quem escreve |
|---|---|---|---|---|
| `posts` | Sim (read) | 50 MB | `image/jpeg|png|webp|gif|heic|heif`, `video/mp4|quicktime|webm` | Authenticated; INSERT/UPDATE/DELETE forçam `(storage.foldername(name))[1] = auth.uid()::text`. |
| `avatars` | Sim (read) | 4 MB | `image/jpeg|png|webp` | Mesmo padrão folder-prefix. |
| `products` | Sim (read) | — | imagens | Portal admin (foto de produto). |
| `style-refs` | Sim (read) | — | `image/*` | Apenas `service_role` via `/api/upload-style-ref` (valida `ADMIN_EMAILS`). Sem policy de INSERT — bucket gated por backend. |

Limites de `posts` foram subidos pra 50 MB pra aceitar vídeo (após o SQL
descrito em CLAUDE.md). Init.sql ainda mostra os valores antigos (8 MB,
só imagem) — o estado real do banco prevalece.

---

## 7. Padrões e convenções

- **Repository pattern via `db.js`** — todo acesso a banco do client
  passa por `window.DB.profiles / follows / posts`. Migrar features
  novas pra esse pattern em vez de chamar `supabase.from(...)` solto.
  Permite trocar implementação sem refatorar callers.
- **Defense in depth** — RLS no banco é a fonte da verdade; o client
  ainda filtra (`WHERE auth.uid()`) por dois motivos: (a) reduz row
  scan, (b) catch de regressão se uma policy for derrubada.
- **`profiles_public` é a view padrão pra leituras de terceiros.** O
  client deve evitar `select *` em `profiles` exceto quando for o
  próprio user ou admin. Email, telefone, lat/lng, dados de pagamento
  ficam fora.
- **RPCs `SECURITY DEFINER`** são o único caminho pra escrever em
  `quotes`, `reviews`, `notifications`, `points` (exceto triggers). Isso
  consolida invariantes (ownership, rating range, anti-duplicata, cap de
  pts) num só lugar.
- **`auth.role() = 'service_role'` é o bypass de hardening** — webhooks
  da loja, `/api/log-error`, upload de style-refs e cleanups rodam com
  service key e ignoram triggers de proteção.
- **`NOTIFY pgrst, 'reload schema'`** depois de qualquer mudança que
  afete o catálogo exposto pelo PostgREST (cache da API).
- **Idempotência:** todo SQL é `IF NOT EXISTS` / `DROP ... IF EXISTS` +
  `CREATE OR REPLACE` — rerrodar `supabase_init.sql` inteiro é seguro.

---

## 8. Migrations

**Workflow:** todo SQL roda manualmente no **Supabase SQL Editor**.
**NÃO usar o MCP Supabase** (`apply_migration`, `execute_sql`, etc) —
ele está conectado a outro projeto e qualquer chamada vai pra base
errada. Quando criar SQL novo:

1. Adicionar ao final de `supabase_init.sql` (idempotente).
2. **Colar o SQL completo no chat** em bloco de código pra o usuário
   copiar e rodar no SQL Editor.
3. Anotar no CLAUDE.md que rodou.

### Waves já aplicadas

- **Initial (pré-Wave):** schema base — `profiles`, `posts`, `follows`,
  `likes`, `comments`, `messages`, `orders`, `quotes`, `jobs`, `reviews`,
  `products`, `points`, `referrals`, `notifications`, `notes`,
  `checklists`, `qualifications`, `courses`, `auto_responses`,
  `follow_ups`, `commissions`, `announcements`, `saved_posts`. Triggers
  básicos (`handle_new_user`, RPCs de quote/review/PRO redeem).
- **B1-B4 (security hardening):** `protect_profile_columns`,
  `audit_events`, `rate_limits`, `check_rate_limit`, scheme allowlist em
  `avatar_url`/`image_url`, storage folder-prefix policies, `tx_id`
  UNIQUE, `points.amount` CHECK.
- **LGPD wave final:** `account_deletion_requests` +
  `request_account_deletion()`, `profiles.consent_at`/`consent_version`,
  `profiles.birth_date`, cleanup functions, fechou SELECT público em
  `quotes`/`orders`.
- **Wave 3 (hardening pós-auditoria 26/05):** `protect_profile_columns`
  BEFORE INSERT OR UPDATE; UNIQUE `points(source, reference_id)`; SELECTs
  de `follows`/`likes`/`comments`/`qualifications`/`courses` restritos a
  `authenticated`; view `announcements_public`; deny-all em
  `rate_limits`; SELECT público restaurado em `reviews`;
  `announcements.created_by` com `ON DELETE SET NULL`.
- **Wave 4 (tabelas faltantes):** `reports` e `feature_interest` —
  fechou 2 bugs do app que escreviam em tabela inexistente.
- **Aplicado fora do init.sql** (referenciado em CLAUDE.md):
  `products.image_url`, `profiles.service_radius`,
  `profiles.archived_conversations`, `profiles.cart`,
  `profiles.ai_logo_gen_count`, `profiles.seen_stories`,
  `profiles.review_count`, INSERT policy em `referrals`,
  `award_referral_points`, `recalc_painter_rating`,
  `sync_profile_tag_username`, bucket `style-refs`, expansão do bucket
  `posts` pra vídeo (50 MB).
