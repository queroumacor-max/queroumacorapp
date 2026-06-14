# Estado do projeto / convenções (não perguntar de novo)

- **RELEASE_AUDIT.md (2026-06-11) — 9 blockers atacados.** Auditoria de
  release nas lojas (Apple App Store + Google Play) em `RELEASE_AUDIT.md`.
  Status atual:
  - **C1 Billing platform**: abstração em `next-app/lib/services/billing-platform.ts`
    detecta web/iOS-wrapper/Android-wrapper e roteia checkout pra
    MP/StoreKit/Play Billing. `/api/play-billing-verify` e
    `/api/apple-iap-verify` são STUBS (aceitam token sem call ao server
    do Apple/Google) — TODO antes de production. Doc: `docs/BILLING_STRATEGY.md`.
  - **C2+C7 iOS scaffold**: `capacitor.config.ts` + `ios/App/App/Info.plist`
    + `ios/App/App/PrivacyInfo.xcprivacy` + `AppDelegate.swift` versionados.
    Falta user instalar Capacitor + rodar `npx cap add ios` em macOS +
    Xcode. Doc: `docs/IOS_BUILD.md`.
  - **C3 Android TWA**: `twa-manifest.json` raiz, `docs/ANDROID_BUILD.md`.
    `.well-known/assetlinks.json` tem SHA-256 + package_name placeholders;
    user precisa gerar keystore via `bubblewrap build` e atualizar.
  - **C4 CSAM (SQL Wave 29)**: tabelas `media_hash_blocklist` +
    `media_review_queue` + coluna `posts.media_hash`. `/api/moderate` agora
    aceita `mediaUrl`, calcula hash SHA-256, checa blocklist (curto-circuita
    Gemini em hit), enfileira review em severity hard+. Admin queue em
    `/admin/media-review`. **SQL JÁ EXECUTADO (2026-06-12).** Falta o
    Cloudflare CSAM Scanning Tool: **NÃO é toggle de painel** (a página
    `/stream/csam` carrega em branco) — exige opt-in legal manual, o
    titular da conta tem que contatar o suporte CF ou mandar email pra
    `cloudflare-csam@cloudflare.com` e assinar o NCMEC Reporting
    Agreement. Doc: `docs/CSAM_POLICY.md`.
  - **C5 age gate <16**: `MIN_AGE=16` em `lib/schemas.ts`, `birthDateSchema`
    obrigatório no signup, revalidação server-side em `signup.ts`. Tests
    cobrindo. ✓ Live.
  - **C6 email verification enforce**: `AuthProvider.emailVerified`
    bloqueia `usePublishPost`, `useComments.add`, `useSendMessage`.
    `<EmailVerifyBanner>` amarelo global com botão reenviar. ✓ Live.
  - **C8 Push Notifications (SQL Wave 30)**: Web Push API end-to-end —
    VAPID JWT ES256 + aes128gcm AES-GCM em `/api/push-notify` (zero deps).
    Tabela `push_subscriptions` + RLS user-owned + trigger pg_net dispara
    push em insert de `notifications`. `<PushOptIn>` no ProfileFooter.
    **SQL AINDA NÃO RODADO** — colar do agent result, habilitar `pg_net`,
    rodar 2 ALTER DATABASE pra setar `app.push_notify_url` e
    `app.push_internal_secret`. Falta gerar VAPID keys e setar 4 ENVs no
    CF Pages: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
    `VAPID_SUBJECT`, `PUSH_INTERNAL_SECRET`. Doc: `docs/PUSH_NOTIFICATIONS.md`.
    iOS: só funciona iOS 16.4+ em modo PWA "Adicionar à Tela de Início".
  - **C9 `/delete-account` web URL**: página pública pra Google Play Policy
    2023. Logado: renderiza DeleteAccountSection. Deslogado: CTA login
    com `?next=/delete-account` (whitelist em `LoginForm`). ✓ Live.
- **5 CRITICALs do audit 2026-06-12 FECHADOS.** Detalhes em
  `next-app/lib/utils/sanitize.ts`, `next-app/lib/auth-server.ts`,
  `next-app/lib/api/env-check.ts` e nos commits `22b6dc9`, `91927d2`,
  `650e7b8`, `047a147`, `948c21a`:
  - **CRIT-1 IAP stubs**: `/api/{play-billing,apple-iap}-verify` agora
    retornam 503 sem `IAP_PRODUCTION_VERIFICATION_ENABLED=true`. NÃO
    setar essa env até implementar verificação real (Google Play
    Developer API + Apple verifyReceipt).
  - **CRIT-2 MP webhook**: fail-closed em prod sem `MP_WEBHOOK_SECRET`.
    Rejeição vai pra `audit_log` (`action='mp.webhook.rejected_no_secret'`).
  - **CRIT-3 XSS Search**: `sanitizeSearchSnippet()` no frontend
    (escape HTML + sentinelas `⟦HL_OPEN⟧`/`⟦HL_CLOSE⟧` viram `<b>`).
    **SQL Wave 31 JÁ EXECUTADO** (`search_all` recria com sentinelas
    no `ts_headline`). Defesa em profundidade ativa.
  - **CRIT-4 Admin RSC auth**: `requireAdminServer()` em todas as 6
    pages `/admin/*`. Login agora grava cookie httpOnly
    `sb-session-token` via `/api/auth/set-session-cookie` (POST=set,
    DELETE=clear no signOut). **Admins precisam logar uma vez após
    o deploy pra gerar o cookie.** Sessões anteriores não habilitam
    `/admin/*` (vão pra 404).
  - **CRIT-5 requirePro fail-closed**: `requirePro()` e `gateAiUsage()`
    em prod sem `SUPABASE_SERVICE_ROLE_KEY` retornam 503. Boot check
    `assertProductionEnvs()` chama no module-load do `security.ts`;
    em vitest skipa salvo `{ force: true }`.
- **Fase 4 etapa 2 da modularização: COMPLETA (2026-05-31).** `app.js`
  caiu de **9176 → 1299 linhas (-86%)**. 338 funções foram extraídas em
  44 módulos sob `modules/*.js` (cada um é um IIFE registrando
  `window.Modules.X`). O bridge `shims.js` republica
  `Modules.X.fn → window.fn` (+ `Utils.X → window.X`) e carrega ANTES do
  `app.js` no `index.html` pra que bare calls em boot-code já tenham as
  globals wireadas. **HTML inline handlers (`onclick="loadFeed()"`)
  continuam funcionando** — toda função visível ao HTML segue exposta como
  `window.X` via shim. NÃO refatorar HTML pra `addEventListener` sem
  necessidade; o padrão IIFE+shim é deliberado pra preservar o contrato.
  85 testes unitários cobrem o que migrou (shims + policies + db +
  schemas + security). Para detalhes ver `ARCHITECTURE.md`.
- **Sentry** **JÁ ESTÁ CONECTADO ao GitHub do projeto** (integração de
  releases/commits/issues entre Sentry ↔ GitHub). Convive com a tabela
  caseira `errors` + dashboard `/admin/errors`; ainda não há decisão se o
  Sentry vira a fonte primária ou só complemento. Se o usuário quiser ligar
  o DSN do Sentry no frontend (sendo carregado pelo browser) ou no
  `/api/log-error` (forwarding server-side), perguntar a variável de env
  exata (`SENTRY_DSN` provavelmente) e os hosts permitidos no CSP
  (`https://*.sentry.io` em `connect-src`).
- O SQL de correção do cadastro ("Database error saving new user" — gatilho
  `handle_new_user` + colunas de `profiles`) **JÁ FOI EXECUTADO no Supabase**.
  Não perguntar de novo nem pedir para rodar.
- Regra de fluxo: após cada correção/melhoria concluída, fazer commit no
  branch de trabalho e **merge para `main`** automaticamente (deploy do
  Cloudflare Pages é automático a partir do `main`).
- **Preview deploys do Cloudflare Pages**: toda branch que NÃO é `main`
  ganha um preview deploy automático em `<branch-slug>.queroumacorapp.pages.dev`.
  Pra features arriscadas (mudanças visuais, fluxos críticos, refactors),
  testar primeiro no preview antes do merge. App mostra banner amarelo
  "🧪 STAGING" no topo quando rodando fora de `queroumacor.com.br`. Detalhes
  do workflow em `STAGING.md`.
- **Após cada merge pra `main`**, aguardar a janela típica de deploy do
  Cloudflare Pages (~90s a partir do push) usando Bash com `run_in_background`
  (`sleep 90 && echo deploy-pronto`) e, quando a notificação chegar, avisar o
  usuário que **provavelmente** está no ar — sendo explícito que é tempo
  decorrido, não confirmação real (egress do container bloqueia
  `queroumacor.com.br` com `host_not_allowed`, e o GitHub MCP não expõe status
  de deploy do Cloudflare Pages). Pedir confirmação do lado do usuário.
- Branch de trabalho atual: `claude/new-session-V0v78`.
- `OPENAI_API_KEY` **e** `GEMINI_API_KEY` **já estão configuradas no Cloudflare
  Pages**. Não perguntar de novo. (Usadas por `chat-ai.js` e
  `resolve-color.js`.)
- A coluna `products.image_url` (text) **já foi criada no Supabase**. Upload
  de foto de produto pelo portal já funciona. Não pedir para rodar o SQL.
- O SQL de persistência total (tabela `checklists` + colunas
  `profiles.service_radius` e `profiles.archived_conversations`) **JÁ FOI
  EXECUTADO no Supabase**. Checklist de obra, raio de atendimento e
  conversas arquivadas agora persistem no banco. Não pedir para rodar de
  novo. Nenhum dado de usuário fica só em `localStorage` (o que sobra lá
  são apenas caches cuja fonte de verdade já é o Supabase).
- O SQL do carrinho e estados de usuário (colunas `profiles.cart`,
  `profiles.ai_logo_gen_count` e `profiles.seen_stories`) **JÁ FOI
  EXECUTADO no Supabase**. Carrinho da loja, contador de logo IA e
  stories vistos persistem no banco. Não pedir para rodar de novo.
- Cores de produto: o botão "Preencher cores (IA)" no portal grava
  `products.color_hex` (IA primeiro, dicionário como fallback). Rodar
  **uma vez**; depois manutenção é manual via seletor de cor. O botão só
  toca em produtos sem cor — seguro reapertar.
- O SQL dos 3 furos de integração (coluna `profiles.review_count`,
  policy de INSERT em `referrals`, triggers `award_referral_points` e
  `recalc_painter_rating`) **JÁ FOI EXECUTADO no Supabase**. Indicações
  gravam linha em `referrals`, pontos por indicação/avaliação recebida
  são creditados por trigger, e `profiles.rating_avg` + `review_count`
  recalculam a cada review. Não pedir para rodar de novo.
- As tabelas `notes` (anotações) e `notifications` (sininho) **JÁ FORAM
  CRIADAS no Supabase** (com RLS e realtime). Anotações salvam/carregam
  e os avisos do `notify()` chegam no sininho. Não pedir para rodar de
  novo.
- **Dados oficiais da Cali Colors (operadora/dona do QueroUmaCor)**:
  - Razão social: **CALICOLORS TINTAS LTDA**
  - CNPJ: **47.677.346/0001-92**
  - Endereço: **Est. Presidente Juscelino Kubitschek de Oliveira, 1071**
  - Bairro: **Jardim dos Pimentas**
  - Cidade/UF: **Guarulhos/SP**
  - CEP: **07.272-345**

  Usar esses dados nos documentos legais (termos, privacidade, sobre),
  metadados do Play Console / App Store, headers do CNPJ no PDF de
  orçamento se o pintor for da Cali Colors, e onde mais precisar de
  identificação formal do controlador LGPD. Já gravados em
  `next-app/app/info/privacidade/page.tsx`, `.../termos/page.tsx`,
  `.../sobre/page.tsx`.

- **Contato da Cali Colors** (atendimento / suporte / "Fale Conosco" /
  solicitações de exclusão de conta LGPD): WhatsApp `(11) 95976-5031`
  (formato wa.me `5511959765031`), e-mail `loja@calicolors.com.br`. Já
  configurado no objeto `SUPPORT` em `app.js`. Usar esse contato sempre
  que precisar de um canal de atendimento/suporte no app.
- **Cache-busting (IMPORTANTE):** `index.html` carrega `head.js` e
  `app.js` com `?v=AAAAMMDD<letra>` (ex.: `?v=20260522a`). **SEMPRE que
  mudar `app.js` ou `head.js`, bump esse `?v=`** nas duas tags `<script>`
  (ex.: `20260522a` → `20260522b`). Se não bumpar, o navegador serve o JS
  velho do cache e a correção não chega no usuário.
- **Regra de SQL:** sempre que criar ou alterar qualquer SQL/migration,
  **colar o conteúdo completo do SQL no chat, em texto** (bloco de código),
  para o usuário copiar e rodar no Supabase SQL Editor. Criar só o arquivo
  no repo não basta — o SQL tem que aparecer no chat. Claude não tem acesso
  ao banco para rodar.
- **SQL Wave 3 (hardening pós-auditoria 26/05) JÁ FOI EXECUTADO no Supabase.**
  Inclui: trigger `protect_profile_columns` BEFORE INSERT OR UPDATE (impede
  escalada de `is_pro`/`portal_access`/`role=admin` via INSERT), UNIQUE em
  `points(source, reference_id)` (anti double-credit), policies de SELECT
  restritas a `authenticated` em `follows`/`likes`/`comments`/`qualifications`/
  `courses`, view `announcements_public` (esconde `created_by`), policy
  deny-all em `rate_limits`, restauração do SELECT público de `reviews`, e FK
  `announcements.created_by` com `ON DELETE SET NULL`. Não pedir para rodar
  de novo.
- **Coluna `profiles.birth_date` (date) JÁ FOI CRIADA no Supabase.** Campo
  preenchido no signup, sem bloqueio etário. Não pedir para rodar de novo.
- **Mailbox `loja@calicolors.com.br` está ativa e responde.** Não perguntar.
- **Turnstile (CAPTCHA)** — está carregado no `index.html` mas nenhum
  endpoint server-side valida o token (`siteverify`). O usuário pediu para
  deixar assim por enquanto. Não wirar a validação sem ele pedir.
- **Google Search Console verificado** via DNS TXT em `queroumacor.com.br`.
  Meta tag também está no `<head>` do `index.html`. Sitemap submetido em
  `https://www.queroumacor.com.br/sitemap.xml`. Não mexer/remover a meta tag.
- **HSTS preload — SUBMETIDO (2026-05-31).** Header em `_headers` agora é
  `max-age=31536000; includeSubDomains; preload`. **Pegadinha resolvida**:
  Cloudflare Edge HSTS (SSL/TLS → Edge Certificates → HSTS) estava
  sobrescrevendo o `_headers` com a flag Preload OFF — foi ativado no
  painel CF. Domínio `queroumacor.com.br` submetido em hstspreload.org,
  validado verde, na fila pra entrar na preload list do Chromium
  (~semanas-meses pra propagar via update de Chrome → Firefox/Safari).
  **Não submeter outros subdomínios sem garantir HTTPS perpétuo** —
  remoção da preload list leva 6+ meses.
- **DMARC pendente em `calicolors.com.br`** (não-bloqueante). O domínio
  `queroumacor.com.br` já tem DMARC `p=reject`. Falta o usuário adicionar
  no GoDaddy o TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:dpo@calicolors.com.br`.
  Não é code-actionable — só ele pode mexer no DNS.
- **SQL Wave 4 — tabelas `reports` e `feature_interest` JÁ FORAM CRIADAS no
  Supabase.** Fixa 2 bugs achados na auditoria de rede social: (1) `app.js
  submitReport()` que estourava erro porque a tabela `reports` não existia;
  (2) `app.js abrirMaquininha/entrarListaMaquininha` que perdiam silenciosamente
  os cliques de interesse (tabela `feature_interest` inexistente). Não pedir
  para rodar de novo.
- **SQL Wave 5 (2026-05-31) — JÁ EXECUTADO no Supabase.** Tabelas
  `consent_log` (LGPD trilha de consentimento por tipo/versão, RLS user-owned),
  `audit_log` (auditoria de ações administrativas — admin reads via
  `is_portal_admin()`; convive com `audit_events` granular trigger-driven),
  `invite_codes` (expiração default 30 dias + `invite_code_valid(text)` RPC),
  função `cleanup_orphan_media()` + `execute_cleanup_orphan_media()`
  (admin-only, deleta arquivos do bucket `posts` sem post referenciando, com
  janela de 7 dias). Cleanup retroativo de `audit_log > 1 ano` via
  `cleanup_old_audit_log()`. Migration única em
  `/migrations/2026-05-31-consent-audit-invites-cleanup.sql`. Client TS de
  consent em `next-app/lib/services/consent.ts`. Trocar para "JÁ EXECUTADO"
  após o usuário rodar no SQL Editor.
- **Bucket Supabase `style-refs` JÁ FOI CRIADO** (público pra leitura, com
  policy `"style-refs public read"` em `storage.objects` só pra SELECT, sem
  policy de INSERT/UPDATE/DELETE — só o endpoint `/api/upload-style-ref`
  escreve via `service_role` depois de validar `ADMIN_EMAILS`). Usado pela
  feature "Arte pra Instagram" pra armazenar templates visuais por estilo
  (`profissional.jpg`, `trabalho.jpg`, `antesdepois.jpg`) que admin sobe pelo
  botão ✏️ no tile. Backend `ig-art.js` carrega de lá primeiro, com fallback
  pra `/style-refs/<key>.jpg` no repo. Não pedir pra rodar SQL desse bucket
  de novo.
- **Plano Supabase: PRO ($25/mês).** Não estamos mais no free tier. Recursos
  adicionais: 8GB DB, 50GB bandwidth, 7 dias de PITR (point-in-time recovery),
  100GB storage, sem project pause por inatividade, log retention de 7 dias.
  Quando sugerir feature que precisa de mais compute / storage / backup,
  pode contar com isso.
- **Plano Cloudflare: PRO.** Recursos adicionais disponíveis: WAF managed
  rules customizáveis, Image Resizing/Polish, mobile redirect, web analytics
  RUM, page rules adicionais. Workers/Pages tem cota maior. Quando sugerir
  feature de perf/edge (image optim, custom WAF rule), pode contar com isso.
- **Backlog / roadmap:** ver `BACKLOG.md` na raiz. Lista categorizada de
  features pendentes (sociais estilo IG, perf, observability, segurança
  externa). Sempre consultar antes de propor features novas — se já está
  no backlog, referenciar pelo ID (ex.: "atacar S1 + S6 do BACKLOG.md").
- **NUNCA consultar o MCP Supabase no queroumacor** a menos que o usuário
  peça explicitamente. O MCP atual está conectado a OUTRO projeto Supabase
  (não o queroumacor `uwqebaqweehiljsqkifm.supabase.co`), então qualquer
  `execute_sql`/`list_tables`/`apply_migration` via MCP vai pro projeto
  errado. Pra mexer em SQL do queroumacor, colar o SQL no chat e o usuário
  roda no SQL Editor.
- **Bucket `posts` agora aceita vídeo.** `allowed_mime_types` inclui
  `image/jpeg|png|webp|gif|heic|heif` + `video/mp4|quicktime|webm`, e
  `file_size_limit` em 50 MB. SQL já foi rodado no SQL Editor. Frontend
  já manda `contentType` explícito no upload. Não pedir pra rodar de novo.
- **`profiles.tag` e `profiles.username` agora são sinônimos sincronizados
  automaticamente.** SQL já rodado: trigger `sync_profile_tag_username`
  BEFORE INSERT/UPDATE preenche o lado vazio com o outro e propaga
  mudanças entre os dois campos. View `profiles_public` projeta
  `tag = coalesce(tag, username)` e `username = coalesce(username, tag)`,
  então frontend continua usando `p.tag` (e o app só escreve em `tag`) —
  pega valor de qualquer coluna que esteja preenchida. View NÃO tem mais
  as colunas `palette` nem `country` (não existem no banco real, foram
  removidas em algum momento). Não pedir pra rodar de novo.
- **SQL Wave 6 (2026-05-31) — JÁ EXECUTADO no Supabase.** Full-text
  search (Banco#9): colunas geradas `search_vector tsvector` em `posts`
  (caption), `products` (name + description com pesos A/B) e `profiles`
  (name + bio + tag com pesos A/B/A), todas com índice GIN. Função RPC
  `search_all(p_query text, p_limit int)` agrega resultados das 3 tabelas
  (com `plainto_tsquery('portuguese')`, `ts_headline` pra snippet e
  `ts_rank` pra score), filtrando posts por `status='approved'`. Migration
  única em `/migrations/2026-05-31-fulltext-search.sql`. Service TS em
  `next-app/lib/services/search.ts`, hook `useSearch` com debounce 300ms,
  página `/search` com input + grupos (Pintores/Posts/Produtos). Trocar
  para "JÁ EXECUTADO" após o usuário rodar no SQL Editor.
- **SQL Wave 7 (2026-05-31) — JÁ EXECUTADO no Supabase.**
  Hardening pagamentos/subscription (Pagamentos#11, #17, #18, #19):
  (1) tabela `invoices` (rastreio de cobrança/refund pra conciliação MP, RLS
  user-owned read; write só via service_role); (2) coluna
  `profiles.pro_grace_until` + função `is_pro_active(uuid)` que considera
  grace period de 3 dias (canSeeProFeature client + gateAiUsage server-side
  usam); (3) tabela `ai_usage` (audit de uso de IA por feature, RLS
  user-owned read; write só via service_role) + RPC
  `ai_usage_this_month(uuid, text?)`; (4) tabela `plan_limits` (free=30,
  pro=500, admin=99999 calls/mês, public read); (5) trigger
  `handle_invoice_paid` (transição `invoices.status → 'paid'` em
  type=subscription propaga `is_pro=true + pro_expires_at +30d` no profile);
  (6) RPC `upsert_invoice(...)` (idempotente por `external_id`, usado pelo
  mp-webhook). Migration única em
  `/migrations/2026-05-31-payments-hardening.sql`. Service novo em
  `next-app/lib/services/billing.ts`; helpers REST edge-friendly em
  `next-app/lib/api/_services/_billing-helpers.ts`; security wrapper
  `gateAiUsage` + `recordAiUsage` em `next-app/lib/api/security.ts`. Todas
  as 14 rotas de IA (`chat-ai`, `caption`, `transcribe`, `tts`,
  `generate-logo`, `area-from-photo`, `pricing-suggest`, `fin-analysis`,
  `crm-draft`, `agenda-order`, `resolve-color`, `moderate`,
  `moderate-video`, `ig-art`) agora chamam `gateAiUsage` antes da IA e
  `recordAiUsage` depois do sucesso. `policies.ts canSeeProFeature` foi
  estendida pra considerar `pro_grace_until`. 21 testes novos em
  `__tests__/services/billing.test.ts` + 5 testes novos em
  `__tests__/policies.test.ts`. Trocar para "JÁ EXECUTADO" após o usuário
  rodar no SQL Editor.
- **SQL Wave 8 (2026-05-31) — soft delete + undo — JÁ EXECUTADO no
  Supabase.** Mira UX#5 (undo de delete) + Banco#13 (soft delete em vez de
  hard). Adiciona coluna `deleted_at timestamptz` em `posts`, `notes`,
  `messages`, `comments`, `quotes`, `checklists`. Atualiza policies de
  SELECT pra esconder rows soft-deleted; admin (`is_portal_admin()`) e
  owner ainda enxergam pra desfazer/auditoria. Indexes parciais
  `idx_<tbl>_active` (`WHERE deleted_at IS NULL`) otimizam queries normais.
  Função `cleanup_soft_deleted()` (SECURITY DEFINER, GRANT só pra
  `service_role`) faz hard delete em rows soft-deleted > 30 dias — chamar
  por cron (pg_cron) ou manualmente. Frontend só em `next-app/`: services
  `postInteractions.deletePost/undoDeletePost/softDeleteComment/undoDeleteComment`,
  `notes.softDeleteNote/undoDeleteNote`, `chat-messages.softDeleteMessage/undoDeleteMessage`,
  todos retornam `{ undoToken }`. Hooks `useDeletePost`, `useDeleteComment`,
  `useDeleteMessage`, `useNotes` expõem `remove + undo`. UI: componente
  `<UndoSnackbar message onUndo>` (countdown 10s) + hook genérico
  `useUndoable<TArgs>` empacotando ciclo. Migration única em
  `/migrations/2026-05-31-soft-delete.sql`. Trocar para "JÁ EXECUTADO"
  após o usuário rodar no SQL Editor.
- **SQL Wave 15 (2026-06-09) — índices de perf — JÁ EXECUTADO no
  Supabase.** 3 índices parciais cobrindo caminho crítico:
  `idx_comments_post_active_created` (post_id + created_at WHERE
  deleted_at IS NULL) acelera `fetchComments`;
  `idx_notifications_user_unread_created` (user_id + created_at WHERE
  read=false) acelera o badge do sininho;
  `idx_posts_approved_active_created` (created_at WHERE status=approved
  AND deleted_at IS NULL) acelera o feed "Todos". Criados
  CONCURRENTLY (sem lock). Migration em
  `/migrations/2026-06-09-perf-indexes.sql`. Não pedir pra rodar de novo.
- **SQL Wave 16 (2026-06-09) — RPC `get_feed_v2` — JÁ EXECUTADO no
  Supabase.** Função SQL agregando posts + autor + like_count +
  comment_count + liked_by_me + saved_by_me + top 3 comments em UMA
  chamada. Substitui o trio Wave A + Wave B do `fetchFeed` (5
  round-trips → 1). **A função existe mas o frontend AINDA NÃO chama
  ela** — swap em `next-app/lib/services/feed.ts:127 fetchFeed()` é a
  Sprint 1.5 (ficou pendente porque user pulou pro Sprint 2 antes).
  Migration em `/migrations/2026-06-09-rpc-get-feed-v2.sql`. Não pedir
  pra rodar SQL de novo.
- **B7 (Web Vitals RUM via Sentry) — DEPLOYADO em 2026-06-09.**
  `sentry.client.config.ts` agora carrega `browserTracingIntegration`
  com `tracesSampleRate: 1.0`. Sentry → Performance → Web Vitals
  começa a popular ~24h depois do primeiro acesso. Não mexer no sample
  rate sem checar quota.
- **B2 (Cloudflare Image Resizing) — código DEPLOYADO mas REQUER
  toggle no painel CF pra valer.** Helper `next-app/lib/cfImg.ts`
  reescreve URLs pra `/cdn-cgi/image/w=...,q=85,f=auto/<original-url>`.
  Avatar e PostMedia usam srcset 1x/2x/3x. **Pra ganhar perf, ligar no
  Cloudflare Dashboard:** Speed → Optimization → **Image Resizing ON**
  + "Resize images from any origin" **ON** + Polish em **Lossy**.
  Enquanto não liga, as `<img>` caem no `onError` e mostram placeholder
  (sem regressão fatal, mas sem ganho). Anotar aqui quando user ligar.
- **SQL Wave 17 (2026-06-09) — width/height em posts (CLS=0) — JÁ
  EXECUTADO no Supabase.** P4 do BACKLOG. Adiciona `posts.media_width`
  e `posts.media_height` (int, opcionais). `usePublishPost` captura
  W/H da primeira imagem via `readImageDimensions()` antes do upload e
  grava no insert. `PostMedia` seta `width={...} height={...}` no
  `<img>` quando presente — browser reserva espaço exato e CLS = 0.
  Posts antigos sem W/H caem no `aspect-ratio: 1/1` CSS (sem
  regressão). RPC `get_feed_v2` foi DROP+CREATE pra incluir as 2
  colunas no RETURNS TABLE. Migration em
  `/migrations/2026-06-09-posts-media-dimensions.sql`. Não pedir pra
  rodar de novo.
- **SQL Wave 18 (2026-06-09) — policies admin pra `reports` — JÁ
  EXECUTADO no Supabase.** O3 do BACKLOG. Adiciona `reports_select_admin`
  e `reports_update_admin` (USING/WITH CHECK `is_portal_admin()`).
  Convive com as policies restritivas existentes via OR. Dashboard em
  `/admin/reports` (RSC shell + `ReportsAdmin` client component) lista
  denúncias por status (pending/reviewed/resolved/dismissed/all) com
  botões Resolver/Dispensar/Marcar revisado. Service em
  `next-app/lib/services/adminReports.ts`. Migration em
  `/migrations/2026-06-09-admin-reports-policies.sql`. Não pedir pra
  rodar de novo.
- **S13 (Modo escuro) — REVERTIDO. App é sempre tema CLARO (commit
  `d0d0e7d`, 2026-06-10).** O dark mode foi removido por decisão de
  produto: não existe mais `ThemeToggle` nem `lib/hooks/useTheme.ts`
  (deletados), nem variante `:root[data-theme="dark"]` no `globals.css`.
  O inline script no `<head>` do `layout.tsx` agora **força**
  `data-theme="light"` em todo load e limpa a chave legada
  `localStorage.theme` de quem tinha ativado dark. NÃO reintroduzir
  toggle de tema sem o usuário pedir.
- **SQL Wave 19 (2026-06-09) — policy admin pra `feature_interest` —
  JÁ EXECUTADO no Supabase.** O2 do BACKLOG. Adiciona
  `feature_interest_select_admin` (SELECT TO authenticated USING
  `is_portal_admin()`). Sem UPDATE/DELETE — tabela é append-only.
  Dashboard em `/admin/feature-interest` (RSC shell +
  `FeatureInterestAdmin` client component) mostra resumo agregado por
  feature (count + último click) com drill-down em lista de cliques
  recentes (usuário + ação + contato + tempo). Service em
  `next-app/lib/services/adminFeatureInterest.ts`. Migration em
  `/migrations/2026-06-09-admin-feature-interest-policy.sql`.
- **Telemetria fetchFeed (Sprint 4 polish) — DEPLOYADO em 2026-06-09.**
  `lib/services/feed.ts` agora chama `addFeedBreadcrumb()` em 3 caminhos:
  `rpc_ok` (sucesso, com row count), `rpc_error` (RPC retornou error,
  fallback legacy), `rpc_throw` (RPC throw, fallback). Breadcrumb vai
  pro Sentry e aparece como contexto em qualquer erro futuro do feed.
  Usar pra decidir quando remover o fallback legacy: se Sentry mostra
  só `rpc_ok` por semanas → seguro firmar.
- **SQL `/migrations/2026-06-09-perf-indexes-check.sql` — NÃO É
  MIGRATION, é auditoria.** Roda EXPLAIN ANALYZE nas 3 queries
  esperadas pelos índices Wave 15 + lista tamanho/scan count via
  `pg_stat_user_indexes`. Cole no SQL Editor pra confirmar que os
  índices estão sendo escolhidos pelo planner. "Seq Scan" no plano =
  índice não cobre, refazer.
- **SQL Wave 22 (2026-06-09) — boost + trending (S11/S12) — JÁ
  EXECUTADO no Supabase.** Coluna `posts.boosted_until timestamptz`
  (NULL = sem destaque) + índice parcial
  `idx_posts_boosted_active WHERE boosted_until > now()`. RPCs:
  `boost_post(uuid, int days=7)` valida ownership + PRO/portal, atomic
  swap (limpa boost ativo anterior do mesmo user antes de aplicar; 1-30
  dias); `unboost_post(uuid)` cancela. `get_feed_v2` recriada
  inserindo até 3 posts boosted no TOPO da PRIMEIRA página (cursor
  NULL); páginas seguintes não inflam — boosted reaparece só por
  created_at. `get_trending_posts(limit, window_days)` retorna posts
  ordenados por score = likes_window + 3*comments_window, exclui
  blocked do user logado, default 7 dias. Frontend: serviços
  `boost.ts` + `trending.ts`, badge "Em destaque" no topo do PostCard
  com gradient laranja, menu opt "Destacar 7 dias (PRO)" / "Remover
  destaque" no opts (só dono), página `/explore` (RSC + client
  `TrendingGrid`) grid 3 colunas com score no canto, atalho
  "Em alta esta semana" no `/search` quando input vazio.
  Migration em `/migrations/2026-06-09-boost-trending.sql`.
- **SQL Wave 23 (2026-06-09) — fix B1 badge verified no feed — JÁ
  EXECUTADO no Supabase.** `get_feed_v2` (Wave 22) omitia `verified` no
  jsonb_build_object do author, então o badge ✓ S1 (Wave 20) só
  renderizava no fallback legacy. DROP+CREATE adicionando
  `'verified', pr.verified` no author_json. Toda a lógica de
  boosted_until + blocks idêntica à Wave 22. Migration em
  `/migrations/2026-06-09-feed-verified-fix.sql`. Não pedir pra rodar
  de novo.
- **SQL Wave 24 (2026-06-10) — unread chat (TopNav badge) — JÁ
  EXECUTADO no Supabase.** Coluna `messages.read_at timestamptz`
  (NULL = não lida) + índice parcial `idx_messages_receiver_unread`
  (receiver_id + created_at WHERE read_at IS NULL AND deleted_at IS
  NULL). RPCs `mark_conversation_read(p_conv_id text)` (SECURITY
  DEFINER, marca todas as msgs da conv onde receiver = auth.uid()) e
  `unread_message_count()` (count total do user logado). Frontend:
  service `chat-messages.markConversationRead/fetchUnreadMessageCount`,
  hook `useUnreadMessageCount` (espelha o de notif: COUNT + realtime
  subscribe em messages filtered by receiver_id), TopNav lê do hook e
  renderiza badge com número (99+ pra >99) — prop `hasUnreadChat`
  removida (era sempre false). ChatConversation chama
  `markConversationRead` em useEffect ao montar. Migration em
  `/migrations/2026-06-10-messages-read-at.sql`.
- **SQL Wave 25 (2026-06-10) — variantes de tamanho de produto — JÁ
  EXECUTADO no Supabase.** Tabela `product_variants(id, product_id FK
  products ON DELETE CASCADE, size_label text, volume_ml int, price
  numeric CHECK >= 0, stock int, sort_order int, created/updated_at)`
  com UNIQUE em (product_id, size_label), índice
  idx_product_variants_product_sort, trigger updated_at via
  set_updated_at(). RLS: SELECT public (anon+authenticated) pra
  catálogo aberto; INSERT/UPDATE/DELETE só `is_portal_admin()`. Modelo
  1:N — products.price segue valendo como fallback quando o produto
  não tem variantes cadastradas (compat). Frontend: service
  `fetchProductVariants` (cast manual pq tabela ainda não está no
  schema TS gerado, rodar `supabase gen types` depois), hook
  `useProductVariants`, ProductDetailSheet renderiza seletor visual
  de chips quando há variantes (cada chip mostra label + preço,
  clique muda preço/CTA). addItemToCart compõe id do CartItem como
  `productId:variantId` pra cada tamanho contar como linha separada
  no carrinho. CartItem já mostra `volume` que agora carrega
  size_label. Base atual da Cali Colors tem 4171 produtos SEM
  variantes — admin precisa popular `product_variants` pra ativar
  seletor (decisão pendente: botão "Gerar variantes" no admin ou
  SQL bulk com regra de preço por proporção). Migration em
  `/migrations/2026-06-10-product-variants.sql`.
- **SQL Wave 26 (2026-06-10) — biblioteca de artes (AR Grafite) — JÁ
  EXECUTADO no Supabase.** Tabela `art_references(id, user_id FK
  profiles ON DELETE CASCADE, title, image_url, tags text[], width,
  height, created/updated_at)` com índices b-tree em (user_id,
  created_at DESC) e GIN em tags, RLS owner-only, trigger updated_at.
  Bucket Supabase Storage `art-refs` (criado pela UI: public read,
  20MB, mime jpeg/png/webp) com policies em `storage.objects` gating
  por `split_part(name, '/', 1) = auth.uid()::text` (path pattern
  `userId/uuid.ext`). Sprint 1 da feature AR Grafite: pintor/grafiteiro/
  admin sobe imagens em `/perfil/grafites` (tile na BusinessGrid
  '🎨 AR Grafite' via ROLE_TILES + ROUTE_TILES pra navegar em vez de
  bottom-sheet). Service `artReferences.ts` faz upload no bucket +
  insert na tabela; cast manual no `from` (tabela fora do schema TS
  gen). Hook `useArtReferences`. **Sprint 2 entregue (2026-06-10)**:
  componente novo `ArtAROverlay` (`app/perfil/grafites/ArtAROverlay.tsx`)
  — câmera ao vivo via getUserMedia (back facing), `<img>` absoluto
  com transform translate/scale/rotate sobre vídeo, touch handlers
  (1 dedo = drag, 2 dedos = pinch + rotate), slider de opacidade
  (10-100%), botão Capturar que composita vídeo + imagem num canvas
  e baixa PNG. Botão "🪄 Projetar na parede" em cada card da
  biblioteca abre o overlay. Migration em
  `/migrations/2026-06-10-art-references.sql` (versão atualizada sem
  INSERT INTO storage.buckets — bucket criado via UI). SQL rodado em
  6 blocos separados pra contornar erro 42601 com `text[] NOT NULL
  DEFAULT '{}'` em alguns editores Supabase managed; default usado foi
  `ARRAY[]::text[]`.
- **SQL Wave 27 (2026-06-10) — RLS hardening pós LAUNCH_AUDIT — JÁ
  EXECUTADO no Supabase.** Fecha os 4 blockers críticos B2-B5 do
  `LAUNCH_AUDIT.md`:
  (B2) `orders` INSERT/UPDATE com `auth.uid()=user_id` no WITH CHECK
  (antes era `WITH CHECK (true)` — user A podia criar order pra B);
  (B3) `messages` ganha UPDATE policy (sender/receiver), SELECT filtra
  `deleted_at IS NULL` (admin via `is_portal_admin()` ainda enxerga);
  (B4) `quotes` SELECT restrito a `client_id` + `painter_id` + admin
  (antes USING `true` expunha phone/address de leads — LGPD);
  (B5) storage `posts` + `avatars` com path validation
  `split_part(name, '/', 1) = auth.uid()::text` (antes qualquer auth
  user podia escrever em qualquer path — path traversal). Path pattern
  `{userId}/...` já era seguido por todos uploads no Next. Migration
  em `/migrations/2026-06-10-wave-27-rls-hardening.sql`. Idempotente.
- **SQL Wave 28 (2026-06-10) — pg_cron pros cleanups — JÁ EXECUTADO no
  Supabase.** Agenda automática das 3 funções de limpeza criadas em
  waves anteriores: `cleanup_old_audit_log()` diário 03:00 UTC,
  `cleanup_soft_deleted()` diário 03:30 UTC, `cleanup_orphan_media()`
  (scan, não execute) semanal domingo 04:00 UTC. Migration em
  `/migrations/2026-06-10-cron-cleanups.sql`. `cron.schedule` é
  idempotente (substitui job de mesmo nome). Inspecionar com
  `SELECT * FROM cron.job`.
- **SQL Waves 29/32/33 (2026-06-12) — JÁ EXECUTADAS no Supabase.** Pacote
  de hardening pré-produção rodado de uma vez:
  - **Wave 29 (CSAM, C4)**: `posts.media_hash` + tabelas
    `media_hash_blocklist` + `media_review_queue` (RLS admin-only via
    `is_portal_admin()`). `/migrations/2026-06-11-csam-media-hash.sql`.
    Falta o Cloudflare CSAM Scanning Tool — **opt-in legal manual**
    (email `cloudflare-csam@cloudflare.com` + NCMEC Agreement), NÃO é
    toggle de painel.
  - **Wave 32 (R-H7)**: `profiles_public` recriada SEM `portal_access`
    (não vazar identidade de admin pra spear-phishing). **A view foi
    rodada SEM as colunas `palette`/`country`** (não existem na tabela
    real) — o arquivo no repo foi corrigido pra refletir isso.
    `/migrations/2026-06-12-profiles-public-hide-admin.sql`.
  - **Wave 33 (R-H8)**: UPDATE policy `"art-refs owner update"` no bucket
    `art-refs` com path enforcement `split_part(name,'/',1)=auth.uid()`.
    `/migrations/2026-06-12-art-refs-update-policy.sql`.
- **QA fixes de produção (2026-06-12) — 2 SQLs JÁ EXECUTADOS.** Pacote de 8
  bugs do QA (BUG-01..07 + UX-04); 6 são código puro, 2 dependiam de SQL:
  - **BUG-02 (busca)**: `profiles.search_vector` recriada incluindo
    `profession` (peso A) + `specialties` (peso B) — buscar "pintor"/
    "grafiteiro"/"textura" agora casa. `search_all` inalterada.
    `/migrations/2026-06-12-search-include-profession.sql`. ✓ Live.
  - **BUG-04 (filtros de feed)**: signup grava `user_type` mas `get_feed_v2`
    filtra por `role` (ficava NULL → filtro vazio). Backfill
    `role ← user_type` + trigger `trg_sync_role_from_user_type` BEFORE
    INSERT/UPDATE (só preenche role vazio, nunca sobrescreve 'admin').
    `/migrations/2026-06-12-role-from-user-type.sql`. ✓ Live. Efeito
    colateral bom: badges de role + chat + suggestions também passam a ver
    a categoria de quem se cadastrou pelo fluxo novo.
- **LAUNCH_AUDIT.md** (na raiz do repo) — auditoria de
  production-readiness via 6 sub-auditorias paralelas. 5 blockers
  iniciais: B1 (vanilla legado) **EM ANDAMENTO** (ports `/avaliar` +
  Maquininha entregues, killswitch SW deployado, delete dos 122
  arquivos pendente); B2-B5 (RLS) **RESOLVIDOS via Wave 27**. Médios
  M6 (Seu Zé visibility), M7 (`/alice` role gate), M8 (ESLint dep
  corruption) **RESOLVIDOS**. Restantes M1-M5+M9-M10: ver audit.
- **SQL Wave 21 (2026-06-09) — plataforma social (S2/S6/S7/S8) — JÁ
  EXECUTADO no Supabase.** Tabela `blocks(blocker_id, blocked_id)` com
  UNIQUE, CHECK (blocker <> blocked), índices em ambas colunas, RLS
  owner-only (SELECT/INSERT/DELETE só pra blocker = auth.uid()). RPC
  `list_blocked_ids()` retorna uuid[] do user logado (cliente filtra
  feed/notif sem N+1). RPC `get_feed_v2` recriada incluindo filtro
  `NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id=p_user_id AND
  blocked_id=p.user_id)`. RPC nova `suggest_to_follow(limit)` retorna
  top pintores não-seguidos (exclui blocked, admin, portal_access),
  ordenando por mesma cidade > mesma UF > rating_avg > review_count >
  created_at. Frontend: serviços `blocks.ts` + `suggestions.ts`, hooks
  `useBlockedList/useBlockedIds/useBlockMutations`, componente
  `<SuggestionsList>` (renderizado no FeedView quando `posts.length=0`
  estilo IG primeira sessão), tela `/perfil/bloqueados`, item no
  ProfileFooter linkando, "Bloquear usuário" no menu opts do PostCard,
  `fetchFeed` legacy também filtra client-side via `listBlockedIds()`
  (defesa em profundidade). Parser `renderRichText(text)` em
  `lib/utils/richText.tsx` transforma `@user` em link `/perfil/<tag>`,
  `#hashtag` em link `/hashtag/<tag>`, e URLs em `<a target=_blank>`.
  Aplicado em PostCard caption + comments. Página `/hashtag/[tag]`
  (RSC + client `HashtagFeed`) lista posts via ILIKE `'%#tag%'` em
  caption — adequado pra volume médio; quando virar gargalo, adicionar
  índice GIN trigram. Migration em `/migrations/2026-06-09-blocks.sql`.
- **SQL Wave 20 (2026-06-09) — quick wins sociais (S1/S4/S5) — JÁ
  EXECUTADO no Supabase.** Adiciona `profiles.verified` (boolean, S1),
  `profiles.instagram_url` + `profiles.website_url` (text, S4),
  `posts.link_url` (text, S5). View `profiles_public` recriada
  incluindo instagram_url + website_url (públicos por design).
  Trigger `protect_profile_columns` revisado pra também impedir
  escalada de `verified=true` por usuário comum (admin-only via
  is_portal_admin). Frontend: PostCard + ProfileHeader mostram badge
  ✓ azul pra `verified || is_pro` (backward compat); EditProfileForm
  ganhou inputs Instagram + Site; ProfileHeader renderiza ícones IG+Site
  no header dark quando preenchidos (normaliza `@user` pra URL completa
  de IG); Composer mostra input "Link 'ver mais'" só em postType='story'
  e grava em `posts.link_url`; StoryViewer renderiza CTA "Ver mais"
  flutuante quando story tem `link_url`. S3 (editar caption) já estava
  implementado em `PostCard.tsx` (modal editOpen + service
  `updatePostCaption`) — item BACKLOG obsoleto. Migration em
  `/migrations/2026-06-09-social-quick-wins.sql`.

