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

## 🔴 Pendências abertas agora (2026-09-16, atualizado após 2ª rodada de verificação por console)

10 dos 17 itens da lista anterior foram fechados/verificados nesta rodada
(ver entrada "2026-09-16 (continuação)" no histórico abaixo). Restam:

| Item | Status | Onde tratar |
|---|---|---|
| SSL/TLS: mode em Full (não Strict), TLS mínimo 1.2 (não 1.3), DNSSEC desligado, sem registro CAA | ⚪ MANUAL, achado concreto | Cloudflare Dashboard — HSTS já está ok |
| Preview env vars do Cloudflare Pages — checado ao vivo e SEM secrets hoje, mas contradiz o `STAGING.md` | ⚪ RECONCILIAR DOC | ver nota na entrada 2026-09-16 (continuação) — reconferir/corrigir `STAGING.md` |
| DMARC de `calicolors.com.br` | ⚪ MANUAL, confirmado ausente via DNS | GoDaddy DNS — `dpo@calicolors.com.br` |
| Cloudflare CSAM Scanning Tool (opt-in legal) | ⚪ MANUAL | contatar `cloudflare-csam@cloudflare.com` |
| Login social PKCE (mobile) — código migrado e testado só em unit test, nunca em aparelho real | ⚪ MANUAL | instalar o AAB/IPA da branch mergeada e logar de verdade com Google e Apple, nas duas plataformas |
| `===` no handshake GET de verificação do webhook WhatsApp | 🔵 RISCO BAIXO | não é o segredo corrente, chamado 1x pela Meta na configuração |
| Janela FIXA de 1 min no `check_rate_limit` (não sliding window) | 🔵 RISCO BAIXO | dá pra dobrar volume na virada do minuto; limites atuais têm folga |
| Bot Fight Mode/Turnstile server-side em `/login`/`/signup` — E captcha desligado no Supabase Auth (mesma lacuna, dois ângulos) | 🔵 DECISÃO | hoje só proteção de borda, sem camada de aplicação nem captcha no Auth |
| Migrar adapter de deploy (`@cloudflare/next-on-pages`, descontinuado) pro OpenNext-Cloudflare | 🔵 DECISÃO/NÃO CORRIGIDO | melhoria arquitetural de médio prazo — não é mais bloqueante de segurança |
| Cloudflare Access na frente de `*.pages.dev` | 🔵 DECISÃO, confirmado que NÃO está configurado | a considerar, Cloudflare Dashboard |

---

## Histórico (mais recente primeiro)

### 2026-09-16 (continuação) — 2ª rodada: 15 dos 17 itens pendentes checados por console
Mesma sessão "Claude in Chrome" (`queroumacor@gmail.com`), na sequência da
verificação dos 4 itens FCM/Firebase abaixo. Cobriu Cloudflare Dashboard,
GoDaddy DNS, Supabase Auth Dashboard, SQL Editor de produção e as rotas
`whatsapp-evo/*` ao vivo.

**Fechados/verificados (9 itens):**
- **`exec_sql`/`executar_sql` — ✅ CONFIRMADO REMOVIDO.** Query direta no
  SQL Editor de produção (`select … from pg_proc where proname ilike
  '%exec_sql%' or '%executar_sql%'`) voltou **0 rows** — a função de
  execução de SQL arbitrário não existe no banco vivo; o DROP rodou.
- **Config de Auth do Supabase — ✅ verificada.** "Confirm email" e
  "Allow anonymous sign-ins" desligados (consistente com o app); Redirect
  URLs (3) escopadas certo; access token 3600s + refresh rotation + reuse
  detection ligados; "Prevent use of leaked passwords" **LIGADO**; MFA
  TOTP disponível. **Achado**: "Enable Captcha protection" **DESLIGADO**
  — dobra sobre o item já conhecido de Bot Fight Mode/Turnstile ausente
  (mesma lacuna vista pelo lado do Auth), não é item novo.
- **5 custom rules do WAF — ✅ confirmadas ativas** (a de bots/scrapers já
  bloqueou 794 tentativas reais) **+ 2 allowlists novas** desde 25/05
  (webhook WhatsApp, `assetlinks.json`).
- **`CLOUDFLARE_API_TOKEN` — ✅ escopo confirmado**: só
  `Cloudflare Pages:Edit`, nada além disso.
- **`SENTRY_AUTH_TOKEN` — ✅ confirmado AUSENTE** do build real do CF
  Pages. Sem risco de segurança (`strip-source-maps.mjs` apaga todo
  `.map` do artefato incondicionalmente, com ou sem token) — só efeito
  operacional: Sentry recebe stack trace minificado.
- **Rotas `whatsapp-evo/*` — ✅ testadas ao vivo, seguras.** `GET
  /webhook` → 405, `GET /ping` → 401 sem token, `GET /followup` → 405.
  Nenhuma vaza dado nem aceita ação sem auth — caminho morto, mas
  fechado. Deixa de ser "não auditado".
- **Cloudflare Access em `*.pages.dev` — confirmado que NÃO está
  configurado** (zero aplicações). Segue sendo decisão do usuário.
- **DMARC de `calicolors.com.br` — confirmado ausente via DNS direto**
  (`_dmarc.calicolors.com.br` → NXDOMAIN). Deixa de ser presumido.
- **Preview env vars do Cloudflare Pages — achado que CONTRADIZ o
  `STAGING.md`.** Painel ao vivo (`queroumacor-next` → Settings →
  Environment variables → Preview) mostra só **5 variáveis públicas**
  (`NEXT_PUBLIC_*` + `VAPID_SUBJECT`) — nenhum secret de produção. Isso
  não bate com a descrição do `STAGING.md`/auditoria Cloudflare de 13/09
  ("Preview roda com os MESMOS secrets de produção"). **Duas explicações
  possíveis, nenhuma confirmada**: o usuário já corrigiu isso no painel
  depois daquela auditoria, ou o `STAGING.md` descreve um risco que nunca
  bateu com a config real. **Não tratar como definitivamente fechado** —
  falta reconciliar o texto do `STAGING.md` com o painel (ou entender por
  que divergem) antes de riscar de vez este item.

**Aberto, com achado novo e mais específico (1 item):**
- **SSL/TLS do domínio**: mode em **Full** (não Full Strict — não valida
  cert da origem); TLS mínimo **1.2** (não 1.3); **DNSSEC desligado**;
  **sem registro CAA**. HSTS está ok. Diferente dos itens "a confirmar",
  este é um gap CONCRETO — decidir se sobe a régua ou aceita como risco.

**Fechado por confirmação direta do usuário (1 item, 2026-09-16):**
- **Acesso Admin de `beatrisporsebon@icloud.com` no Apple Developer é
  INTENCIONAL** — confirmado pelo usuário. Não era vulnerabilidade; era
  só um contato que a memória do projeto não reconhecia. Sem ação.

**Sem mudança:** PKCE mobile (só testável com AAB/IPA em aparelho real);
`===` no handshake GET do webhook WhatsApp; janela fixa do rate limit;
migrar adapter pro OpenNext; Cloudflare CSAM Scanning Tool (segue
exigindo contato manual por e-mail, não é toggle self-service).

### 2026-09-16 — Verificação MANUAL dos 4 itens de console (Firebase/GCP/Apple)
Checado pelo usuário via sessão separada de "Claude in Chrome" (esta sessão
de código não tem acesso a browser/console). Fecha os 4 itens ⚪ MANUAL
VERIFICATION que restavam da auditoria FCM/APNs/Push de 2026-09-13 — os
únicos 4 achados daquela auditoria que não eram verificáveis pelo repo.
- **Conta**: verificado logado como `queroumacor@gmail.com` (dono real do
  Firebase/GCP/Apple Developer — `jackson.guerra@gmail.com` não tem acesso
  a esses consoles).
- **Firebase/GCP IAM**: ✅ limpo. 3 principals no projeto: o owner +
  2 service accounts, sendo uma delas `codemagic-play-publisher` (usada
  pelo Codemagic pra publicar o AAB na Play Store — uso esperado e
  documentado no CLAUDE.md).
- **Idade das service account keys**: ✅ limpo. 1 chave ativa por conta,
  as duas com ~13 dias (criadas em 2026-09-03) — nenhuma chave órfã, antiga
  ou duplicada.
- **Quotas/billing do FCM no Google Cloud**: ✅ limpo. Sem conta de billing
  vinculada (confirma plano Spark/gratuito). Quota do FCM em 600.000
  req/min, uso em 0%. **Achado adicional, não-bloqueante**: 0 alert
  policies configuradas no Cloud Monitoring — o toggle global de alertas do
  Firebase está ligado, mas não existe categoria de alerta específica pra
  "limite de plano" do FCM porque ele não tem custo/teto no Spark (não é um
  gap de configuração, é ausência de recurso aplicável).
- **Apple Developer — Users and Access**: 2 usuários com acesso:
  `queroumacor@gmail.com` (Jackson Matos, Account Holder + Admin) e
  `beatrisporsebon@icloud.com` (Beatris Porsebon, **Admin** — acesso
  completo, incluindo a chave APNs `2R6FW9F2F6`). Esse segundo contato
  não aparecia em nenhuma entrada anterior do CLAUDE.md. Cross-checado
  contra a lista de colaboradores do próprio Firebase Console, que bateu
  exatamente com a IAM do GCP (nenhuma discrepância entre os dois lados).
  **✅ CONFIRMADO PELO USUÁRIO (2026-09-16): o acesso é INTENCIONAL** —
  não era vulnerabilidade, só um colaborador que a memória do projeto
  ainda não tinha registrado. Sem ação necessária.
- A chave APNs em si (`2R6FW9F2F6`, "QueroUmaCor APNs", criada 2026-09-04,
  Team Scoped, Sandbox & Production) segue única, sem duplicatas/órfãs —
  consistente com o que já estava documentado no CLAUDE.md.

### 2026-09-13/16 — Auditoria de segurança do Supabase (RLS/policies/grants/RPCs)
SQL `2026-09-13-leads-rls-critical.sql` — ✅ **JÁ EXECUTADO** (2026-09-16,
confirmado pelo usuário: a consulta de conferência do fim do arquivo voltou
as 3 linhas com `ok=true`). Escopo: RLS, policies, grants, roles, functions,
RPCs, triggers, views, Storage, Realtime, Auth, cron, service role.
- **CRÍTICO**: `public.leads` NUNCA teve RLS habilitada por nenhuma migration
  deste repositório — a tabela nasceu FORA do repo (sem `CREATE TABLE`
  correspondente, só `ALTER TABLE ... ADD COLUMN`), e por isso nunca passou
  pelo "gancho" de lembrar de protegê-la (as outras 50 tabelas criadas no
  repo têm `ENABLE ROW LEVEL SECURITY` pelo menos uma vez cada). Qualquer
  usuário comum do app, ou a própria chave `anon`, conseguia ler/escrever
  os ~1072 contatos de prospecção (nome, telefone, categoria, cidade, status)
  direto pela API REST do Supabase, sem passar pelo portal nem por
  `is_portal_admin()`. Fix: RLS habilitada + policy `leads_admin_all`
  restrita a `is_portal_admin()` + `anon` sem GRANT algum. O app consumidor
  (`next-app/`) não toca essa tabela — travar não tirou acesso de ninguém.
- **Falsos positivos confirmados seguros** (lidos no SQL final, não
  presumidos): `products`/`orders`/`announcements`/`commissions` tinham
  `USING(true)` no `supabase_init.sql` original, mas já foram fechadas pra
  `is_portal_admin()` num hardening anterior; `profiles_public` (view) já
  tem `security_invoker=true`; `exec_sql`/`executar_sql` (execução de SQL
  arbitrário, herança do vanilla) já tiveram EXECUTE revogado e DROP escrito
  (execução real em produção não confirmada — ver tabela de pendências);
  100% das 52 funções SECURITY DEFINER do histórico têm `SET search_path`
  (sem risco de search-path hijacking); bucket `whatsapp-media` corretamente
  privado; trigger `protect_profile_columns` bloqueia auto-promoção a admin;
  os 4 cron jobs (pg_cron) têm corpo fixo, sem superfície de injeção.
- **Aceito como risco baixo, não corrigido**: `push_device_tokens` UPDATE
  usa `USING(true)` de propósito (reatribuição de aparelho compartilhado
  pelo token físico) — exploração exigiria adivinhar um UUID que não vaza
  em nenhum SELECT.
- **Não verificado nesta rodada** (fora do aprofundamento desta sessão):
  matriz completa das 50 tabelas × 4 operações (foi um sweep de
  `USING(true)`, não uma tabela linha-a-linha); Storage buckets além de
  `whatsapp-media`; Realtime publications além de `whatsapp_messages`;
  configuração de Auth (redirect URLs, expiração de JWT, MFA, leaked
  password protection, captcha) — só no Dashboard do Supabase, MANUAL
  VERIFICATION (ver tabela de pendências no topo).
- **Autocrítica registrada**: um comentário de código escrito na mesma
  sessão, antes desta auditoria, afirmava "a RLS de `leads` continua
  valendo" sem nunca ter checado — a própria auditoria corrigiu essa
  suposição, não só o código. Regra: suposição sobre RLS de uma tabela não
  é fato até alguém ler a tabela de políticas dela.

### 2026-09-16 — `GEMINI_API_KEY` vazada: confirmado que já não está ativa
✅ **RESOLVIDO.** A chave vazada no histórico do Git (commit `a735531`,
`queroumacorportal.html`) termina em `...sZN_IE`. No Google AI Studio (API
Keys, filtro "All projects") só existem duas chaves ativas hoje —
`...iVmQ` (projeto "Quero uma cor", o que importa) e `...LsIU` (projeto
"JR Erp") — nenhuma bate com o final da vazada. Como o Google só lista
chaves que ainda existem (uma revogada some da lista, não fica marcada
como inativa), a vazada já não existe mais na conta — não tem como ser a
que está configurada em `GEMINI_API_KEY` no Cloudflare Pages hoje. Não dá
pra ler o valor do secret salvo no CF Pages direto (Cloudflare não exibe
secret já gravado), mas a lógica fecha sem precisar disso: chave que não
existe mais não pode ser a que está em uso. Confirmado pelo usuário. Não
pedir pra rotacionar de novo.

### 2026-09-15 — Auditoria Mobile completa (Capacitor/Android/iOS/WebView)
Branch `claude/mobile-security-audit-b36g38` (commits `af59a79`…`927f466`),
mergeada na `main` por pedido explícito do usuário. Suíte inteira verde (163
arquivos / 2119 testes), typecheck e `next build` limpos. Escopo: Capacitor,
Android, iOS, WebView, bridge nativa, plugins, OAuth mobile, deep links,
storage de token, permissões, Firebase/FCM, câmera, filesystem, uploads,
networking, logs, backups, clipboard, exported components, release build —
166 itens conferidos contra OWASP MASVS/MASTG.
- 🔵→✅ **CRÍTICO CONTIDO NESTA AUDITORIA, CORRIGIDO NA RAIZ pela auditoria
  Cloudflare (ver abaixo)**: CVE-2025-66478/CVE-2025-55182 (RCE, CVSS 10.0)
  em `next@15.5.2` — desserialização do protocolo Flight via header
  `Next-Action`, alcançável em qualquer rota do App Router mesmo sem o app
  declarar Server Actions. Nesta sessão a versão estava presa porque
  `@cloudflare/next-on-pages@1.13.16` (descontinuado) tem peer range
  `next: >=14.3.0 && <=15.5.2` — teto exato na versão vulnerável — então a
  correção aqui foi só CONTER: mitigação em `next-app/middleware.ts`
  (qualquer requisição com header `Next-Action` barrada com 404, seguro
  porque zero `'use server'` no repo). Essa mitigação FICA como defesa em
  profundidade. A correção de verdade veio da auditoria Cloudflare, em
  paralelo: `next` → `15.5.25` (acima do patch 15.5.3+ que corrige o CVE,
  mesma minor) destravado via `next-app/.npmrc` (`legacy-peer-deps=true`,
  só ignora o teto do peer range do adapter) e validado com `npm run
  build:cf` ponta a ponta. Migrar o adapter (OpenNext-Cloudflare) continua
  como melhoria arquitetural, sem mais ser bloqueante de segurança.
- ✅ **Android `allowBackup` true→false** — a sessão do Supabase (localStorage/
  cookies da WebView) não entra mais no Auto Backup/`adb backup`.
- ✅ **Push nativo (FCM) sem cleanup no logout** — em aparelho compartilhado,
  trocar de conta deixava quem saiu recebendo notificação até a próxima
  conta sobrescrever o mesmo token FCM. `currentNativePushToken()` (lê sem
  abrir prompt) + `clearDeviceTokenOnLogout()` no `AuthProvider.signOut`;
  badge do ícone zera ao desmontar. Complementar (não conflita) com o fix de
  RLS/RPC `upsert_push_device_token` da auditoria FCM/APNs/Push abaixo —
  aquela fecha o hijack de escrita entre contas, esta fecha o vazamento de
  notificação pra quem já saiu.
- ✅ **Drift de CSP entre `_headers` (raiz) e `next.config.mjs`** — `media-src`
  sem `https://*.supabase.co` num dos dois podia bloquear `<video>`/`<audio>`
  do Supabase Storage em página estática pré-renderizada. Ficaram idênticos
  + teste de paridade (`cspHeadersParidade.test.ts`).
- ✅ **OAuth mobile migrou de implicit flow pra PKCE** (commit `927f466`).
  `lib/supabase.ts` ganhou `flowType:'pkce'`; o callback do deep link nativo
  (`br.com.queroumacor.app://auth/callback`) passa a carregar `?code=...`
  (uso único) em vez de tokens crus no fragment — o que o Android loga no
  Logcat deixa de ser sessão utilizável sozinha (o `code` precisa do
  `code_verifier`, que nunca sai do storage da WebView).
  `exchangeCodeForSession` troca o code pela sessão; o `setSession` com
  tokens crus virou fallback defensivo, nunca acionado com PKCE ligado. O
  fluxo web não mudou — o supabase-js já troca `?code=` sozinho no boot.
  Testes novos cobrindo o parser + 3 cenários de `nativeSignInWithOAuth`.
- ⚪ **NOT VERIFIED**: build nativo real (`.aab`/`.apk`/`.ipa`) — ambiente sem
  Android SDK e sem macOS/Xcode, só revisão de código/config; rodar no
  Codemagic (ou local com SDK/Xcode) antes de confiar cegamente nas
  mudanças de manifest/config.
- Achados baixos, sem ação necessária: `.well-known/assetlinks.json` é resto
  de uma versão TWA anterior ao Capacitor (sem efeito hoje, sem
  intent-filter `autoVerify` no manifest atual); `FileProvider`
  (`file_paths.xml`) com `path="."` mais amplo que o necessário, mas não
  exportado e é o template padrão do plugin de câmera; sem Universal
  Links/Android App Links verificados (só o custom scheme do OAuth) —
  funcional pro que existe hoje.
- Arquivos: `_headers`, `android/app/src/main/AndroidManifest.xml`,
  `next-app/middleware.ts`, `next-app/components/{AuthProvider,
  NativeBadge}.tsx`, `next-app/lib/native/{index,push,auth}.ts`,
  `next-app/lib/services/pushTokens.ts`, `next-app/lib/supabase.ts` + 9
  arquivos de teste (3 novos: `androidManifestSecurity`,
  `capacitorWebviewSecurity`, `cspHeadersParidade`).
- **Reconciliação de merge**: `main` avançou 17 commits enquanto esta branch
  estava aberta, incluindo duas outras auditorias de segurança em paralelo
  (rate limiting/abuse e FCM/APNs/Push, ambas listadas abaixo). Conflito só
  em texto (este arquivo, `CLAUDE.md`, `push-nativo.test.ts`) — nenhuma
  colisão semântica nas correções de código; `pushTokens.ts` recebeu
  contribuições das duas auditorias (RPC de ownership + cleanup de logout)
  e as duas se somam sem conflito. **Segunda reconciliação** minutos depois:
  o push foi rejeitado porque a auditoria Cloudflare (abaixo) mergeou `main`
  no meio do caminho; único conflito novo foi a tabela de pendências deste
  arquivo (mesma causa: duas branches editando o mesmo ponto), resolvido
  concatenando as duas listas — foi essa auditoria que corrigiu de verdade
  o CVE que esta sessão só conteve (ver nota atualizada acima).

### 2026-09-15 — Rate limit em mensagens + push de mensagem sem texto
SQL `2026-09-15-chat-safety-hardening.sql` — ✅ **JÁ EXECUTADO** (2026-09-15,
confirmado pelo usuário). Fecha os 2 itens que a auditoria de FCM/push abaixo
tinha deixado pendentes, por pedido explícito do usuário.
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

### 2026-09-13/15 — Auditoria completa Cloudflare (132 seções)
Branch `claude/cloudflare-security-audit-gurtsy`, pedido explícito do usuário.
Cobriu DNS, TLS, WAF, Workers/Pages, cache, secrets, CI/CD e o artefato REAL do
build (não só `.next`). Relatório completo das 132 seções entregue no chat da
sessão; detalhe completo no `CLAUDE.md`.
- **CRITICAL**: `next` 15.5.2 tinha 3 CVEs CRITICAL (RCE via React Flight
  protocol, exposição de código-fonte de Server Actions, DoS) — bump pra
  `15.5.25` (mesma minor, dentro do teto de peer dep do
  `@cloudflare/next-on-pages@1.13.16` deprecado, via `next-app/.npmrc
  legacy-peer-deps=true`). Build `npm run build:cf` reproduzido do zero.
- **HIGH**: 157 source maps do bundle client-side ficavam PÚBLICOS no artefato
  de produção — sem `SENTRY_AUTH_TOKEN` no build, o plugin do Sentry pula o
  upload E o apagamento do `.map`. `next-app/scripts/strip-source-maps.mjs`
  (novo, plugado no `build:cf`) apaga todo `.map` do artefato final
  independente do token existir.
- **HIGH**: `deploy.yml` (workflow_dispatch) podia publicar PRODUÇÃO a partir
  de QUALQUER branch — travado com `if: github.ref == 'refs/heads/main'`.
- **MEDIUM**: chave Gemini ia na query string (`?key=...`) em 8 pontos —
  movida pro header `x-goog-api-key`. Chave Gemini também **vazada no
  histórico do Git** (`queroumacorportal.html`, commit `a735531`) — rotação
  segue pendente (ver tabela de pendências no topo).
- Webhook Evolution (legado): comparação de token `!==` → `safeEqual` (tempo
  constante). `ios-screenshots.yml` ganhou `permissions:` mínimo. `next-app/`
  entrou no `dependabot.yml` (só cobria o `package.json` da raiz antes).
- **Confirmado por evidência real** (curl via `wrangler pages dev` contra o
  artefato publicado, não suposição): CSP/HSTS/COOP/CORP/Permissions-Policy
  aplicados corretamente em `/login`, `/portal` e rotas prerenderizadas — a
  fonte única é `headers()` do `next.config.mjs`; artefato final pós-fix com
  **0** `.map`, **0** `.env*`, **0** `service_role` key vazada. `_headers`/
  `_redirects` da RAIZ do repo (fora de `next-app/`) são **INERTES** —
  Cloudflare Pages só lê esses arquivos de DENTRO do build output.
- **Sessão 15/09 (continuação) — itens de código fechados**: `/api/
  ig-art-diag` virou admin-only de verdade (`ensurePortalAdmin` depois do
  `gateProAI` — o comentário sempre disse "PRO + admin", só PRO era
  checado); scanner de segredos **gitleaks** entrou no CI
  (`.gitleaks.toml`+`.gitleaksignore`+self-test, recuperados de uma branch
  nunca mergeada, validados contra os 1519 commits do histórico inteiro com
  o binário real: 0 leaks); `scripts/load-test.js` restaurado (apagado sem
  querer num cleanup antigo, `load-test.yml` rodava arquivo inexistente
  desde então). Não sobrou nenhum item de CÓDIGO pendente desta auditoria —
  só os itens MANUAL/DECISÃO listados na tabela de pendências no topo.
- Testes: 2097/2097 verdes, typecheck limpo. Testes novos:
  `whatsapp-evo-webhook-auth.test.ts`, `gemini-key-not-in-query-string
  .test.ts`, `strip-source-maps.test.ts`.

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
