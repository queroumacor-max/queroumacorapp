# Estado do projeto / convenções (não perguntar de novo)

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
- **S13 (Modo escuro) — DEPLOYADO em 2026-06-09.** CSS vars dark em
  `:root[data-theme="dark"]` no `globals.css` + inline script no
  `<head>` lê `localStorage.theme` (ou `prefers-color-scheme` fallback)
  e seta data-theme ANTES do hydrate (sem FOUC). Hook `useTheme` em
  `lib/hooks/useTheme.ts`. Componente `<ThemeToggle withLabel />`
  inserido no `ProfileFooter` acima do botão "Sair". Cards com
  `bg-white` hard-coded são interceptados por regra global
  `:root[data-theme="dark"] .bg-white { background-color: var(--color-white) }`
  pra ficarem escuros — refinar componente-a-componente se aparecer
  contraste ruim.
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

