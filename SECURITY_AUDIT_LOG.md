# Security Audit Log — índice único e atualizado

Este arquivo é o **resumo consolidado só de segurança** do projeto — reescrito em
2026-09-15 porque a versão anterior parou em 25/05/2026 e não refletia nada do
que veio depois (RLS hardening, admin auth, CSAM, rate limiting, FCM/push,
etc.). Tudo aqui foi extraído do `CLAUDE.md` (a memória viva e completa do
projeto — cobre TODO o histórico, não só segurança) e dos 3 documentos de
auditoria de fase única (`ARCHITECTURE_AUDIT_2026-08-26.md`, `LAUNCH_AUDIT.md`,
`RELEASE_AUDIT.md`).

**Regra de manutenção:** toda vez que uma sessão fizer uma auditoria ou
correção de segurança, adicionar uma entrada aqui (mesmo padrão de baixo) —
não deixar esse arquivo envelhecer de novo. O `CLAUDE.md` continua sendo a
fonte de verdade mais detalhada e mais recente sempre que houver divergência
com este arquivo; se algo aqui contradiz o `CLAUDE.md`, o `CLAUDE.md` ganha.

**Convenção de status:**
- ✅ **FIXED** — corrigido em código e/ou SQL, já rodando em produção.
- 🟡 **SQL PENDENTE** — código pronto, SQL escrito, aguardando o usuário rodar.
- 🔵 **DECISÃO/NÃO CORRIGIDO** — reportado, risco aceito ou fora de escopo por
  decisão explícita.
- ⚪ **MANUAL VERIFICATION REQUIRED** — não verificável pelo repo/ambiente;
  exige acesso a um console externo (Firebase, Apple, Cloudflare, GoDaddy).

---

## 🔴 Pendências abertas agora (2026-09-15)

| Item | Status | Onde tratar |
|---|---|---|
| DMARC de `calicolors.com.br` | ⚪ MANUAL | GoDaddy DNS — `dpo@calicolors.com.br` |
| Cloudflare CSAM Scanning Tool (opt-in legal) | ⚪ MANUAL | contatar `cloudflare-csam@cloudflare.com` |
| Firebase IAM / membros do projeto / roles do service account | ⚪ MANUAL | Firebase Console → IAM |
| Quantidade/idade das service account keys (Firebase) | ⚪ MANUAL | Firebase Console → Service Accounts |
| Revisão de acesso ao Apple Developer (posse da chave APNs) | ⚪ MANUAL | developer.apple.com |
| Quotas/billing alerts do FCM no Google Cloud | ⚪ MANUAL | Google Cloud Console |
| Rate limit na camada de MENSAGENS (chat) | 🟡 SQL PENDENTE | código pronto em `2026-09-15-chat-safety-hardening.sql`, aguardando o usuário rodar |
| Conteúdo de mensagem em texto puro no `body` do push (lock screen) | 🟡 SQL PENDENTE | mesmo arquivo acima — push de mensagem passa a mandar rótulo genérico |
| `===` no handshake GET de verificação do webhook WhatsApp | 🔵 RISCO BAIXO | não é o segredo corrente, chamado 1x pela Meta na configuração |
| Janela FIXA de 1 min no `check_rate_limit` (não sliding window) | 🔵 RISCO BAIXO | dá pra dobrar volume na virada do minuto; limites atuais têm folga |
| Rotas `whatsapp-evo/*` (Evolution API aposentada) | 🔵 NÃO AUDITADO | caminho morto, endpoint ainda existe |

---

## Histórico (mais recente primeiro)

### 2026-09-15 — Rate limit em mensagens + push de mensagem sem texto
SQL `2026-09-15-chat-safety-hardening.sql` — 🟡 **SQL PENDENTE**. Fecha os 2
itens que a auditoria de FCM/push abaixo tinha deixado pendentes, por pedido
explícito do usuário.
- `messages` ganhou rate limit PRÓPRIO (trigger `BEFORE INSERT`,
  `check_rate_limit` por par remetente→destinatário, 30/min) — antes só o
  *dispatch do push* tinha teto (continha o sintoma, não a causa: a
  mensagem em si, fora do push, era ilimitada).
- `dispatch_push_on_notification` parou de copiar o texto real da mensagem
  pro corpo do push — manda um rótulo genérico ("Fulano enviou uma
  mensagem"). `notifications.body` (usado na tela `/notificacoes` dentro do
  app) não muda, só o que sai pelo push.
- Testes: `__tests__/chatSafetyHardening.test.ts` (lê o SQL, trava os
  invariantes) + caso novo em `__tests__/lib/errors-friendly.test.ts`.

### 2026-09-13/15 — Firebase / FCM / APNs / Push (auditoria #11 da rodada)
SQL `2026-09-13-fcm-push-hardening.sql` — ✅ **JÁ EXECUTADO** (2026-09-15).
- **CRÍTICO**: `push_device_tokens` UPDATE RLS usava `USING (true)` — qualquer
  usuário autenticado podia fazer `PATCH ?user_id=eq.<vítima>` direto no
  Supabase e sequestrar o registro de push de outra pessoa (DoS no push
  dela). Fix: RPC SECURITY DEFINER `upsert_push_device_token` (sempre grava
  `user_id=auth.uid()` lido no servidor) + policy volta a exigir
  `auth.uid()=user_id` nos dois lados.
- **MÉDIO**: nenhum teto no nº de tokens/subscriptions que um usuário cria
  pra si mesmo → amplificação de fan-out em qualquer push endereçado a ele.
  Fix: trigger de teto (20/usuário) + query do `/api/push-notify` limitada.
- **MÉDIO**: `dispatch_push_on_notification` sem rate limit por
  destinatário (mensagem virou 1-push-por-mensagem em 04/09, sem teto). Fix:
  `check_rate_limit(user_id, 'push-dispatch', 20, 1)` antes do `net.http_post`.
- **Verificado e correto sem mudança**: `push_subscriptions` (web push) já
  tinha RLS certa; FK `ON DELETE CASCADE` já limpa tokens de conta deletada;
  stale token cleanup (404/410/UNREGISTERED) já existia; nenhum secret/`.p8`
  no repo; deep link do toque só aceita path interno; sem uso de FCM topics
  nem notification actions customizadas.
- Testes: `__tests__/push-nativo.test.ts`, `__tests__/api/push-notify-ratelimit.test.ts`.

### 2026-09-13 — Rate limiting / abuse (auditoria geral de segurança)
SQL `2026-09-13-security-audit-hardening.sql` — ✅ **JÁ EXECUTADO**.
- **CRÍTICO**: `check_rate_limit(p_user_id uuid,...)` — o parâmetro era UUID,
  mas toda chave por IP/composta é STRING (`ip:1.2.3.4`, `push-notify:1.2.3.4`
  etc). PostgREST recusava (22P02→400) e `checkRateLimit` tratava isso como
  "serviço indisponível" → **fail-open silencioso desde que foi escrito**.
  Login/signup/reset por IP, `/api/log-error`, `/api/push-notify` e os 7
  endpoints de `enforceRateLimit` (checkout, delete-account, upload-style-ref,
  apple-iap-verify, play-billing-verify, cidades, reverse-geocode,
  auth/set-session-cookie) nunca tiveram rate limit por IP de verdade. Fix:
  coluna e parâmetro viram `text`.
- **ALTO**: `search_all(p_query, p_limit)` sem REVOKE — `anon` podia chamar
  a RPC direto no Supabase, sem passar pelo `/search` e sem rate limit, e
  `p_limit` sem teto aceitava valores absurdos. Fix: `LIMIT
  LEAST(coalesce(p_limit,20),100)` + REVOKE de PUBLIC/anon + GRANT só
  `authenticated`.
- **CORRIGIDO em código**: 9 rotas de IA liam o corpo cru sem teto de
  tamanho antes do parse (`rejectOversizedBody`, pré-check por
  `Content-Length`) — chat-ai, alice, senna, fe, generate-logo, ig-art,
  transcribe, area-from-photo, receipt-ocr.
- Falsos positivos descartados (verificados): tokens de IA já tinham teto;
  `moderate-video` já tinha SSRF guard; webhooks já eram idempotentes;
  `whatsapp/send`/`followup` já usavam `safeEqual`.

### 2026-09-10 — Rotas admin aceitam quem foi promovido no portal
SEM SQL. **Achado**: promover alguém no portal (`portal_access=true`) não
bastava — toda rota de servidor exigia e-mail em `ADMIN_EMAILS` mesmo assim
(403 pra admin promovido de verdade). Fix: `ensurePortalAdmin({callerId,
email})` — allowlist OU `portal_access=true` OU `role='admin'`, lidos com
service key. `__tests__/api/admin-portal-access.test.ts` varre `app/api` e
proíbe rota voltar a chamar `ensureAdminEmail`/`isAdminEmail` direto.
`ADMIN_EMAILS` continua como porta de emergência.

### 2026-09-07 — Admin apaga post de outra pessoa (moderação)
Confirmado no banco, sem SQL pendente (`is_portal_admin()` já cobria a
policy). **Achado**: app já deixava admin apagar comentário alheio, mas não
post (filtro `.eq('user_id', userId)` no UPDATE nunca casava linha pro
admin). Fix: `comoAdmin` remove o filtro extra — permissão real continua
vindo só da RLS, cliente adulterado sem ser admin bate na policy e volta
zero linhas. **Lacuna conhecida, não resolvida**: apagar post alheio não
deixa rastro de QUAL admin agiu (`audit_log` sem policy de INSERT pra
`authenticated`).

### 2026-09-04/05 — WhatsApp Cloud API / Dualhook (canal único)
- Webhook autenticado por `payload` mode (valida WABA + phone_number_id) ou
  `hmac` (X-Hub-Signature-256 + META_APP_SECRET), nunca os dois misturados.
- `WHATSAPP_WEBHOOK_URL_SECRET` no `?token=` da URL — segredo nunca
  registrado em nenhum arquivo do repo (mesma regra do keystore/access
  token da Meta).
- **BUG DE SEGURANÇA CORRIGIDO**: `sendWhatsAppMessage`/`sendWhatsAppTemplate`
  usavam `normalizeBrPhone` (cola '55' em qualquer nº de 10-11 dígitos) —
  contato estrangeiro virava número BR inexistente. Trocado por
  `normalizeWhatsAppTarget` (regra do NANP + regra do 3º dígito). Não é
  vazamento de dados, mas é envio pro destinatário errado.
- Evento não-mensagem (`account_update` etc) devolvia 403 → Meta reenviava
  pra sempre; virou 200 sem trabalho. Mensagem endereçada a OUTRO número
  continua sendo rejeitada (não é "evento que não interessa", é config
  errada).
- `waitUntil` chamado solto (`const w = ctx.waitUntil; w(...)`) quebrava com
  `Illegal invocation` — corrigido pra sempre chamar no objeto dono
  (`ctx.waitUntil(...)`). Não é vuln, mas travava o 200 obrigatório pra Meta.

### 2026-09-04 — Par cruzado de env do Supabase (auth bypass silencioso)
**Achado grave, PR #202**: `SUPABASE_URL` ausente, `SUPABASE_ANON_KEY`
existia como secret de OUTRO projeto Supabase (herança do app vanilla).
`getSupabaseUrl()`/`getSupabaseAnonKey()` resolviam CADA UMA independente →
GoTrue recebia apikey de um projeto e token de outro, 401 pra QUALQUER
usuário. **Fix estrutural**: `resolveSupabaseEnv()` único resolvedor —
tenta o par `NEXT_PUBLIC_*` INTEIRO, cai pro par sem prefixo INTEIRO, nunca
meio a meio. Guarda nova: `ref` do JWT anon × `ref` do host
`<ref>.supabase.co` — divergência vira `env_project_mismatch` explícito.
6 resolvedores divergentes existiam no repo; 2 guards de arquitetura em
`__tests__/lib/supabase-env-single-resolver.test.ts` impedem regressão.

### 2026-09-03 — P0 da auditoria de arquitetura (ver `ARCHITECTURE_AUDIT_2026-08-26.md`)
Todos ✅ FIXED:
- **C1**: `gateProAI`/`gateProAIForm` deixavam requisição SEM TOKEN passar
  pra IA sem PRO, rate limit nem cota — agora 401 pra anônimo/token inválido.
- **C2**: CSP + Permissions-Policy + COOP/CORP + CORS restrito em `/api/*`
  centralizados no `next.config.mjs` (o `_headers` da raiz nunca chegava ao
  deploy real — seria uma 2ª política divergente).
- **C3/A-D1**: `SELECT public.is_portal_admin()` recriada com `to_jsonb`
  (coluna ausente vira NULL, não estoura); policy furada "View quotes
  active" derrubada; `auth-server.ts` parou de selecionar `is_admin`
  (coluna que não existe na tabela real).
- **C5**: branch protection com check `validate` obrigatório confirmado
  (recusa `405 Required status check` no merge).
- **C6**: jspdf 2→4.2.1 (CVE crítica eliminada); next pinado exato (peer
  range do next-on-pages).

### 2026-09-01 — Varredura de `process.env` cru (57 leituras corrigidas)
**Achado**: 38 arquivos liam `process.env` direto em vez de
`getRuntimeEnv()` — no edge do Cloudflare os secrets do painel NÃO existem
em `process.env`, só no request context. Toda a camada de IA + pagamentos +
`/api/health` podiam estar rodando com config errada em produção sem
ninguém perceber. Teste de arquitetura (`__tests__/lib/
env-runtime-rule.test.ts`) varre `lib/api`/`app/api` e falha se a leitura
crua voltar.

### 2026-09-01 — Auditoria P1-P9 (achado de segurança relevante: P3)
**P3**: `resolveCalicolorsUserId` usava `.ilike('name','%cali%').limit(1)`
sem `order` — casava com qualquer nome parecido de forma não-determinística
e abria a conversa "🎨 Loja" pra ESSE id. Dava pra mandar mensagem pra um
estranho pensando que era a loja. Fix: só igualdade exata (tags conhecidas
→ nome exato); erro do Supabase não é mais lido como "não existe".

### 2026-08-29 — Foto sem MIME type / validação de mídia
**Achado**: 8 pontos de upload (avatar, chat, publicar, cadastro, arte-ig,
logo, quals, dimensões) confiavam só em `file.type`, que a WebView do
wrapper podia entregar vazio ou `application/octet-stream`. Fix em 3
degraus: tipo declarado → extensão → magic numbers (bytes). Importa porque
os buckets têm `allowed_mime_types` — subir como octet-stream seria
recusado pelo Storage mesmo já tendo passado (ou não) pela validação da
tela; sem essa correção o app rejeitava upload legítimo (falso negativo de
segurança virando bug de produto).

### 2026-08-29 — "Busca AI" de leads removida (geração de dados falsos com PII)
**Achado real de privacidade/segurança**: o botão "✨ Busca AI" mandava o
modelo INVENTAR empresas plausíveis, incluindo TELEFONE — número inventado
em formato válido é o telefone de alguém de verdade, e o botão "💬 Abordar"
ao lado mandaria mensagem real pra esse número. Removido inteiro; base
tinha 0 registros gerados assim (não precisou limpar).

### 2026-08-28 — SQL Wave 43/44 — exclusão de conta segura
`admin_delete_user(uuid, boolean)` SECURITY DEFINER — cascata inteira roda
dentro do Postgres (a rota edge morria com 502 do Cloudflare durante a
chamada ao GoTrue). Guardas: `is_portal_admin()`, nunca a própria conta,
nunca conta admin/portal sem `p_force_admin=true` (3ª confirmação no
portal). Wave 44 varreu TODAS as FKs `public→profiles/auth.users` com
`NO ACTION/RESTRICT` (causa raiz do 502: `quotes_painter_id_fkey` sem
`ON DELETE`) e recriou com `SET NULL`/`CASCADE` conforme nullability.

### 2026-08-28 — SQL Wave 42 — RLS de `quotes` restaurada
RPCs `create_painter_draft`/`create_quote_from_post` só existiam no
`supabase_init.sql`, nunca recriadas como SECURITY DEFINER numa wave
incremental — o hardening de RLS derrubou o INSERT direto e a função viva
batia na policy. Recriadas as 2 RPCs canônicas + policy de INSERT fallback
(cliente só cria quote própria; pintor só rascunho sem client_id).

### 2026-08-22 — Edge do Cloudflare: secret não chega em `process.env`
**Descoberta estrutural**: variáveis do painel do Pages só existem no
request context (`Symbol.for('__cloudflare-request-context__')`), não em
`process.env`. Causou 403 real no portal admin (`admin-config.ts` parseava
`ADMIN_EMAILS` no module-load, cache nascia sempre vazio). Regra
consolidada: **nada que dependa de env pode rodar no module-load** — sempre
`getRuntimeEnv()`, nunca `process.env` direto, e nunca no boot.

### 2026-08-22 — SQL Wave 35 — visibilidade de chat 3-way (`messages`)
**Achado**: a policy de SELECT de `messages` liberava só sender/receiver —
o 3º participante (a loja, quando adicionada a uma conversa 1:1) não via as
próprias mensagens. Fix: participante ESTRUTURAL via
`POSITION(auth.uid()::text IN conversation_id) > 0`. **Decisão de
segurança registrada**: NÃO usar "tem mensagem sua nessa conversa" como
regra — o `conversation_id` é derivado de UUIDs públicos, e qualquer um
poderia inserir uma mensagem na conversa alheia só pra passar a ler o
histórico.

### 2026-08-22 — SQL Wave 37 — bucket de logos (`brand_logos`)
RLS owner + `is_portal_admin()` pra SELECT; `cleanup_orphan_media()`
recriada porque a versão anterior (Wave 5) considerava órfão TODO arquivo
do bucket `posts` sem post — incluindo os logos, que teriam sido apagados
por engano pelo cron de limpeza.

### 2026-08-21 — SQL Wave 34 — venda restrita a profissional (defesa em profundidade)
Trigger `trg_enforce_post_for_sale_role` (BEFORE INSERT/UPDATE em `posts`)
zera `for_sale`/`price`/`art_type` quando `role='cliente'` — a mesma regra
já existia no client (`canMarkPostForSale`), mas o `forSale` sobrevivia a
troca de aba/autosave/deep-link e podia vazar pro banco sem essa segunda
trava. **Achado paralelo**: `profiles.is_admin` não existe na tabela real
apesar de aparecer em código/migrations legadas — qualquer SQL novo que
toque colunas de admin usa `to_jsonb(p)->>'campo'` (coluna ausente vira
NULL, não estoura 42703).

### 2026-06-18 — Login social + guard de cadastro incompleto
OAuth Google/Apple via Supabase. **Achado de segurança em 21/08**: se o
redirect do provedor não pousasse em `/completar-perfil` (Redirect URL fora
da allowlist), a pessoa ficava com perfil pela metade PRA SEMPRE — sem
`@tag`, invisível na busca. Fix: `AppShell` refaz o redirect
(`isProfileComplete` + `router.replace`) em toda tela privada, não só no
momento do OAuth.

### 2026-06-18 — Modo visitante removido (login voltou a ser obrigatório)
Guard no `AppShell`: sem sessão, `router.replace('/login?next=...')` e o
conteúdo privado não renderiza. Decisão de produto com efeito direto em
superfície de ataque — sem guest, toda ação exige `auth.uid()` real.

### 2026-06-12 — 5 CRITICALs do audit de 2026-06-12 (todos ✅ FIXED)
- **CRIT-1**: `/api/{play-billing,apple-iap}-verify` eram stubs que
  aceitavam qualquer token IAP sem verificar no servidor da Apple/Google —
  fail-closed (503) sem `IAP_PRODUCTION_VERIFICATION_ENABLED=true`.
- **CRIT-2**: MP webhook agora fail-closed em produção sem
  `MP_WEBHOOK_SECRET` (rejeição vai pro `audit_log`).
- **CRIT-3**: XSS na busca — `sanitizeSearchSnippet()` escapa HTML antes de
  processar as sentinelas do `ts_headline` (defesa em profundidade, SQL
  Wave 31 também corrigiu na origem).
- **CRIT-4**: as 6 páginas `/admin/*` não tinham auth real no RSC —
  `requireAdminServer()` + cookie httpOnly `sb-session-token`.
- **CRIT-5**: `requirePro()`/`gateAiUsage()` fail-closed (503) em produção
  sem `SUPABASE_SERVICE_ROLE_KEY` configurada.

### 2026-06-11 — `RELEASE_AUDIT.md` (release nas lojas — 9 blockers)
Ver arquivo completo. Itens de segurança fechados: **C4** (CSAM: tabelas
`media_hash_blocklist`/`media_review_queue`, hash SHA-256 em toda mídia
antes de aceitar publicação — falta só o opt-in legal do Cloudflare
Scanning Tool, MANUAL); **C5** (age gate <16 obrigatório no signup, com
revalidação server-side); **C6** (bloqueio de ações — publicar, comentar,
mensagem — sem e-mail confirmado); **C8** (push notifications VAPID +
aes128gcm, ver seção FCM/Push acima pro estado atual); **C9**
(`/delete-account` público — exigência LGPD/Play Policy 2023).

### 2026-06-10 — `LAUNCH_AUDIT.md` (production-readiness — RLS)
SQL Wave 27 fechou os 4 blockers críticos B2-B5: **orders** (WITH CHECK
exigindo `auth.uid()=user_id` — antes qualquer user criava order em nome de
outro); **messages** (UPDATE policy + filtro `deleted_at`); **quotes**
(SELECT restrito a `client_id`/`painter_id`/admin — antes vazava
telefone/endereço de TODO lead pra QUALQUER usuário autenticado, LGPD);
**storage `posts`/`avatars`** (path validation `split_part(name,'/',1) =
auth.uid()::text` — antes qualquer usuário autenticado escrevia em
QUALQUER path do bucket, path traversal real).

### 2026-06-09 — SQL Waves 29/32/33 (CSAM + hardening)
- **Wave 29**: infraestrutura de hash CSAM (ver RELEASE_AUDIT C4 acima).
- **Wave 32 (R-H7)**: `profiles_public` recriada sem `portal_access` — a
  view pública não deve dizer QUEM é admin (superfície de spear-phishing).
- **Wave 33 (R-H8)**: bucket `art-refs` ganhou policy de UPDATE com
  enforcement de path (só o dono edita a própria referência).

### 2026-06-09 — SQL Waves 18/19/21 — admin RLS + blocks
`reports`/`feature_interest` ganharam policy de SELECT restrita a
`is_portal_admin()`. Wave 21 criou `blocks` (bloqueio de usuário) com RLS
owner-only e RPC `list_blocked_ids()` — o feed/notificações filtram
bloqueados server-side, não só no client.

### 2026-05-31 — SQL Wave 3 (hardening pós-auditoria 26/05)
Pacote base de RLS que sustenta quase tudo que veio depois:
`protect_profile_columns` (trigger BEFORE INSERT/UPDATE — impede qualquer
usuário escalar `is_pro`/`portal_access`/`role='admin'` via INSERT direto),
UNIQUE em `points(source, reference_id)` (anti double-credit de pontos),
policies de SELECT restritas a `authenticated` em `follows`/`likes`/
`comments`/`qualifications`/`courses`, view `announcements_public` (esconde
`created_by`), policy deny-all em `rate_limits` (ninguém lê/escreve direto,
só as funções SECURITY DEFINER), FK `announcements.created_by ON DELETE
SET NULL`.

### 2026-05-31 — SQL Wave 5 — audit trail + consentimento LGPD
`consent_log` (trilha de consentimento por tipo/versão), `audit_log`
(auditoria de ações administrativas, lido só via `is_portal_admin()`),
`invite_codes` (expiração automática de 30 dias).

### 2026-05-31 — SQL Wave 7 — hardening de pagamentos/assinatura
`invoices` (rastreio pra conciliação MP, RLS user-owned read/service-role
write), `pro_grace_until` + `is_pro_active(uuid)` (grace period real em vez
de corte seco), `ai_usage` (audit de uso de IA por feature, anti-abuso de
cota), `plan_limits` (teto mensal por plano), `gateAiUsage`/`recordAiUsage`
plugados nas 14 rotas de IA — nenhuma rota de IA aceita chamada sem
gate+contagem.

### 2026-05-25 — Sessão de hardening externo (DNS/TLS)
Ver detalhe completo nesta seção — era o conteúdo original deste arquivo:
- Google Search Console verificado via DNS (propriedade de domínio,
  cobre www + subdomínios + http/https).
- HSTS: max-age 12 meses + `includeSubDomains` (preload adicionado depois,
  ver `queroumacor.com.br` já validado verde no hstspreload.org). TLS
  mínimo 1.2. No-Sniff ON.
- `queroumacor.com.br`: DMARC `p=reject` ✅. `calicolors.com.br`: SPF ✅,
  **DMARC ainda pendente** (ver pendências abertas no topo).
- 5 regras de segurança no Cloudflare (bots verificados, países de risco,
  scrapers, admin paths suspeitos, portal fora de BR/US/PT).

---

## Referência — auditorias-documento completas (não resumidas aqui)

- `ARCHITECTURE_AUDIT_2026-08-26.md` — auditoria de arquitetura (100% do
  repo, 6 sub-auditorias paralelas). Achados C1-C6 já fechados (ver acima).
- `LAUNCH_AUDIT.md` — production-readiness (20 áreas, 2026-06-10). Blockers
  B1-B5 fechados; alguns médios M1-M10 dependem de ação externa do usuário.
- `RELEASE_AUDIT.md` — release nas lojas Apple/Google (2026-06-11). 9
  blockers, status por item na seção acima.
- Cada wave de SQL individual tem seu próprio arquivo em `/migrations/` com
  o achado, a exploração e o fix documentados no cabeçalho — este índice
  aponta pra eles, não os substitui.
