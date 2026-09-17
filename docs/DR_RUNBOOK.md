# DR Runbook — QueroUmaCor

> Procedimentos de disaster recovery / business continuity. Complementa
> [`RUNBOOK.md`](./RUNBOOK.md) (deploy/manutenção rotineira) e
> [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) (severidades, LGPD).
> O relatório completo da auditoria que gerou este documento está em
> [`DR_AUDIT_2026-09-17.md`](./DR_AUDIT_2026-09-17.md) (inventário,
> matrizes, findings classificados).
>
> **Regra de ouro deste documento**: nenhum comando destrutivo aqui usa
> um valor real — todo placeholder é `<ASSIM>`. Nenhum secret real
> aparece neste arquivo. Comandos que apagam/sobrescrevem dado vêm
> marcados com 🔴 **DESTRUTIVO**.

---

## Como pensar em qualquer restore

```
BACKUP T0 ──── produção continua até T1 ──── DISASTER ──── RESTORE T0
```

Tudo que aconteceu entre T0 e T1 — pagamentos, exclusões de conta,
mensagens, uploads, webhooks, pontos/indicações, moderação — **não
volta sozinho** com o restore. Restaurar sem reconciliar é tão
perigoso quanto perder o dado. Antes de declarar qualquer restore
"concluído", passar pela [Reconciliation Matrix](#reconciliation-matrix)
abaixo.

---

## Owner / Break Glass

- **Owner único documentado**: Jackson Guerra (`jackson.guerra@gmail.com`)
  — GitHub (write), Cloudflare, Supabase, Codemagic, Google Play,
  Firebase. Confirmado pela auditoria: nenhum outro nome aparece em
  nenhum doc do repo para esses 6 provedores.
- **Segunda pessoa documentada**: `queroumacor-max` (GitHub, admin/dono)
  e `beatrisporsebon@icloud.com` (Apple Developer, Admin — confirmado
  intencional pelo usuário em 2026-09-16, per CLAUDE.md).
- **Consequência prática**: para GitHub, Cloudflare, Supabase, Codemagic,
  Google Play e Firebase, a indisponibilidade do owner É um cenário de
  disaster recovery em si (SINGLE PERSON DEPENDENCY — ver
  [`DR_AUDIT_2026-09-17.md`](./DR_AUDIT_2026-09-17.md#single-points-of-failure)).
  Isto é documentado, não corrigido aqui (mudança de acesso/organização
  é decisão do usuário, não uma correção de código).
- Nenhuma credencial de break-glass estática está guardada neste repo
  ou em qualquer doc — correto (não deveria estar). Se uma existir fora
  do repo (cofre de senhas, papel, etc.), isso é MANUAL VERIFICATION —
  fora do alcance desta auditoria.

---

## Secret Recovery Matrix

Nenhum valor real. "Rotação" = como trocar; "Impacto se ausente" = o
que quebra (fail-open/closed já auditado, ver `DR_AUDIT_2026-09-17.md`
§Secrets).

| Secret | Owner (provedor) | Como rotacionar | Impacto se ausente/vazado |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API | Reset no dashboard → atualizar em CF Pages (produção + preview) → **Retry deployment** (env não propaga sem novo deploy) → smoke test `requirePro`/`gateAiUsage`/admin/mp-webhook/me-export | Vazado: acesso total de leitura/escrita a TODAS as tabelas via REST, bypass de RLS. Ausente: `requirePro`/`gateAiUsage` fail-closed em produção (503), não fail-open — confirmado em `lib/api/security.ts`. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → API | Idem acima. **Trocar os DOIS JUNTOS, do MESMO projeto** — a auditoria de 2026-09-04 (par cruzado) documenta o incidente de trocar um sem o outro. | Par divergente = 401 "token_invalid" para todo mundo (incidente já ocorrido e corrigido — `resolveSupabaseEnv()` agora valida `project ref` cruzado). |
| `GEMINI_API_KEY` | Google AI Studio → API Keys | Gerar nova key no projeto "Quero uma cor" → revogar a antiga → atualizar CF Pages → redeploy | Ausente: rotas de IA (chat, moderação, arte) respondem 503 explícito. Moderação de mídia cai fail-open (exceto 429) — ver `lib/services/moderateMedia.ts`. |
| `OPENAI_API_KEY` | platform.openai.com → API Keys | Gerar nova → revogar antiga → CF Pages → redeploy | 503 explícito em `caption`/`chat-ai` se ausente. |
| `MP_ACCESS_TOKEN` | Mercado Pago Developers | Gerar novo token de produção → CF Pages → redeploy | Checkout/preapproval param quebram; sem fallback silencioso identificado — 500 explícito esperado. |
| `MP_WEBHOOK_SECRET` | Mercado Pago Developers (assinatura de webhook) | Gerar novo → configurar no painel MP → CF Pages → redeploy | Fail-closed em produção (401, `rejected_no_secret` no audit_log) — confirmado em `mp-webhook.ts`. |
| `DUALHOOK_API_KEY` | Dualhook (integração WhatsApp/Meta) | Gerar novo na conta Dualhook → CF Pages → redeploy | `ServiceError` explícito ("não configurado") — não falha em silêncio. |
| `WHATSAPP_WEBHOOK_URL_SECRET` / `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Dualhook (par com a URL cadastrada) | **Gerar os dois juntos** (`openssl rand -hex 24` para o URL secret) → colar em CF Pages **e** reeditar a URL no Dualhook — são um PAR, trocar só um lado derruba o recebimento | Sem eles: nenhuma mensagem WhatsApp chega (401 no webhook) — silencioso do lado do cliente (a mensagem simplesmente não aparece no portal). |
| `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | Gerado localmente (`npx web-push generate-vapid-keys`) | Gerar novo par → CF Pages → redeploy. **Trocar invalida TODAS as subscriptions de web push existentes** (usuários precisam reativar) | Ausente: `PushOptIn` retorna `null` (componente some, sem erro visível). |
| `PUSH_INTERNAL_SECRET` | Gerado localmente | Gerar novo → CF Pages **e** `app_settings.push_internal_secret` (SQL) — também um PAR | Ausente/divergente: dispatch de push falha silenciosamente entre o trigger do banco e a rota. |
| `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` | Firebase Console → Service Accounts (gerar nova chave JSON) | Gerar nova chave → extrair os 3 campos → CF Pages → redeploy → revogar a chave antiga no Firebase | Falha é por-envio, com timeout — não bloqueia a ação do usuário que disparou a notificação (confirmado: FCM tem `TOKEN_TIMEOUT_MS`/`SEND_TIMEOUT_MS`). |
| APNs `.p8` (Key ID documentado em CLAUDE.md) | Apple Developer → Certificates, Identifiers & Profiles → Keys | **Não pode ser re-baixado.** Se perdido (não apenas revogado): revogar a antiga no Apple Developer → gerar NOVA key → re-upload no Firebase Console → Cloud Messaging → Apple app config (Sandbox + Production). Nenhuma mudança de código necessária (Firebase medeia APNs). | Perda sem rotação: push iOS para de funcionar silenciosamente após o próximo restart de token. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS` (JSON) | Google Cloud Console → IAM → Service Accounts | Deletar chave antiga → criar nova chave JSON → atualizar grupo de env `google_credentials` no Codemagic | Vazado: pode publicar AAB arbitrário na track `internal` (supply-chain). Ausente: `android-aab` workflow falha ao publicar (mas ainda gera o AAB, artifact fica só no Codemagic/email). |
| Codemagic keystore ref (`queroumacor_keystore`) | Codemagic → Team → Code signing identities | Local keystore perdido ≠ chave de assinatura perdida (Play App Signing ativo — Google guarda a chave real). Se o arquivo local (`my-release-key.jks`) sumir: Play Console → App integrity → App signing → "Request upload key reset" (requer verificação de identidade, leva dias). | Sem o keystore local e sem reset: impossível gerar novo AAB assinado até o reset ser aprovado pela Google. |
| Codemagic `app_store_connect` integration | Codemagic → Integrations | Reconectar via App Store Connect API key no painel Codemagic | Build iOS não consegue assinar/publicar; sem evidência de fallback manual documentado. |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens | Gerar novo → GitHub Actions secret `SENTRY_AUTH_TOKEN` (se algum dia usado — hoje **não é referenciado em nenhum workflow**, ver `DR_AUDIT_2026-09-17.md`) | Ausente hoje: sem impacto de segurança (source maps são apagados do artefato de qualquer forma pelo `strip-source-maps.mjs`); impacto é só operacional (sem symbolication no Sentry). |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → My Profile → API Tokens | Revogar antigo → criar novo com o MESMO escopo mínimo (`Cloudflare Pages:Edit`) → GitHub Actions secret | Vazado: escopo documentado é Pages:Edit — MANUAL VERIFICATION se isso permite excluir o projeto Pages, não só deployar (ver Findings). |
| `ADMIN_EMAILS` | Env var (não é secret rotativo, é config) | Editar lista em CF Pages → redeploy | Lista vazia/errada = ninguém cai no allowlist de emergência; o acesso via `portal_access`/`role=admin` no banco continua valendo independentemente. |

---

## Kill Switches (o que já existe / o que falta)

| Sistema | Kill switch existente | Onde | Gap |
| --- | --- | --- | --- |
| WhatsApp — auto-resposta IA | `whatsapp_ai_config.default_on` + toggle por conversa | Portal (botão "IA ligada/desligada") | Não existe flag pra desligar `/api/whatsapp/send` inteiro (envio manual/abordagem continua mesmo com a IA desligada) |
| WhatsApp — follow-up automático | `whatsapp_ai_config` toggle | Portal | — |
| IA (chat/legenda/moderação) | Nenhum "master switch" — só falta de API key (503) | env | Não há flag de negócio pra desligar sem tirar a key (afeta TODAS as features de IA de uma vez, sem granularidade) |
| Push (web + nativo) | Nenhum | — | Kill switch ausente — para parar push seria preciso `DROP TRIGGER trg_dispatch_push_notification` (SQL manual) |
| Uploads/mídia | Nenhum | — | Kill switch ausente — mitigar via rate limit ou desabilitar rota manualmente |
| Pagamentos (MP) | `MP_WEBHOOK_ENFORCE` (fail-closed sem secret) | env | Não é bem um kill switch de negócio — é uma trava de segurança; para parar checkout seria preciso desabilitar a rota |
| IAP (Apple/Google in-app) | `IAP_PRODUCTION_VERIFICATION_ENABLED` (default desligado) | env | Comportamento correto (fecha por padrão) |

**Recomendação (não implementada nesta sessão — decisão de produto)**:
um flag único `app_settings.emergency_kill_switches` (jsonb, ex.
`{"whatsapp_send": false, "push": false, "ai": false}`) lido por cada
rota crítica no início do handler, editável pelo portal admin sem
deploy. Ficaria pronto para uma próxima sessão implementar se
priorizado — está fora do escopo desta auditoria (é feature nova, não
correção de um achado).

---

## Runbooks por cenário

Cada runbook segue: **DETECT → STOP → PRESERVE → RESTORE → RECONCILE →
VERIFY → RETURN TO SERVICE**.

### A. Bad deploy (deploy ruim)

1. **DETECT**: Sentry issue nova com spike, `/api/health` não-200,
   usuário reporta.
2. **STOP**: nada a "parar" — Cloudflare Pages já serviu o build. Não
   há kill switch de deploy em andamento (deploy já é atômico do lado
   CF Pages).
3. **PRESERVE**: anotar o SHA do deploy ruim e o horário (para
   post-mortem e para saber a partir de qual commit reconciliar).
4. **RESTORE**: `.github/workflows/rollback.yml` (`confirm=ROLLBACK`,
   `target_sha` = último commit bom) OU Cloudflare Pages Dashboard →
   Deployments → "Rollback to this deployment" (mais rápido, não
   depende de CI). Ver `RUNBOOK.md §5`.
5. **RECONCILE**: se o deploy ruim gravou dado incorreto no banco
   (não só bug de UI), reverter/corrigir esse dado é ação separada —
   rollback de código não desfaz escrita no banco.
6. **VERIFY**: `/api/health` 200, Sentry para de crescer, smoke test
   manual (login, feed, publish).
7. **RETURN TO SERVICE**: comunicar internamente, abrir post-mortem em
   `docs/incidents/`.

### B. DROP acidental de tabela / migration destrutiva rodada por engano

> A auditoria confirmou: **nenhuma migration deste repo contém
> `DROP TABLE`/`TRUNCATE`/`DELETE` sem `WHERE`** (varredura das 101
> migrations). Este cenário, se acontecer, seria por comando manual no
> SQL Editor — fora do fluxo normal do projeto.

1. **DETECT**: erro em produção (`relation does not exist` /
   contagem de linhas zerada / `/admin/errors` cheio de 500s de uma
   tabela específica).
2. **STOP**: se identificável, desabilitar a feature que usa a tabela
   (ver Kill Switches) para não gerar mais erro nem escrita
   inconsistente enquanto investiga.
3. **PRESERVE**: **não rodar mais nenhum SQL manual** até confirmar o
   escopo — cada novo comando é uma chance de piorar. Se possível,
   `pg_dump --schema-only` do estado atual antes de restaurar (ver
   `DR_AUDIT_2026-09-17.md` — hoje não existe esse hábito, recomendado
   como melhoria).
4. **RESTORE**: Supabase Dashboard → Database → Backups → PITR →
   escolher timestamp ANTES do DROP. 🔴 **DESTRUTIVO**: PITR restaura o
   banco INTEIRO, não só a tabela — todo dado escrito depois do
   timestamp escolhido é perdido, incluindo tabelas não relacionadas.
5. **RECONCILE**: **obrigatório**, ver [Reconciliation Matrix](#reconciliation-matrix)
   abaixo — pagamentos, exclusões de conta, mensagens do WhatsApp,
   webhooks e mídia enviada entre o timestamp restaurado e o momento
   do disaster.
6. **VERIFY**: `select * from public.dr_integrity_report();` (migration
   `2026-09-17-dr-deletion-tombstone-and-integrity.sql`) + smoke test
   completo (§Smoke Test abaixo) + reconferir RLS
   (`__tests__/lib/leads-rls-migration.test.ts`-style: toda tabela com
   `CREATE TABLE` tem `ENABLE ROW LEVEL SECURITY`).
7. **RETURN TO SERVICE**: comunicar, documentar em
   `SECURITY_AUDIT_LOG.md` se envolveu segurança, senão em
   `docs/incidents/`.

### C. Storage deletion (bucket ou objetos apagados)

1. **DETECT**: imagens quebradas em massa no feed/perfil/loja;
   `select * from public.dr_integrity_report();` mostra contagem alta
   em `posts_media_url_missing_from_storage` / `profiles_avatar_url_missing_from_storage`.
2. **STOP**: **não rodar `execute_cleanup_orphan_media()`** (ver aviso
   em `RUNBOOK.md §Rollback de banco`) — pode apagar o que sobrou.
3. **PRESERVE**: anotar quais buckets/paths foram afetados.
4. **RESTORE**: Supabase Storage **não tem PITR próprio documentado**
   nesta auditoria (MANUAL VERIFICATION — ver Findings). Se não houver
   backup de Storage, os arquivos apagados são **irrecuperáveis** por
   este projeto (a menos que o usuário tenha cópia local/CDN cache).
5. **RECONCILE**: para posts/perfis com referência quebrada, decidir
   produto: remover a referência (post fica sem foto) ou marcar para
   o usuário reenviar.
6. **VERIFY**: `dr_integrity_report()` volta a `ok` nos dois checks de
   storage.
7. **RETURN TO SERVICE**: se afetou usuários visivelmente, considerar
   aviso via `announcements`.

### D. Supabase account compromise

1. **DETECT**: atividade não reconhecida no Supabase Dashboard, dados
   alterados sem explicação, alerta de login.
2. **STOP**: trocar senha da conta Supabase + revogar sessões ativas no
   Dashboard (Account → Security) imediatamente.
3. **PRESERVE**: **antes de rotacionar `SUPABASE_SERVICE_ROLE_KEY`**,
   se possível, exportar `audit_log` para fora do Supabase (ele é a
   trilha forense e também pode ter sido a primeira coisa apagada por
   um atacante — ver Findings sobre `deletion_tombstones`/Sentry).
4. **RESTORE**: se houver escrita maliciosa confirmada, avaliar PITR
   para um ponto antes da intrusão — mas ver nota #240 do prompt
   original: **um restore não remove necessariamente o payload
   malicioso se ele foi inserido há mais de X dias e o restore for
   para um ponto recente**; identificar o "clean restore point" exige
   saber quando a intrusão começou.
5. **RECONCILE**: rotacionar `SUPABASE_SERVICE_ROLE_KEY` e o par
   `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` **só se o projeto mudar** (URL
   não muda por rotação de key). Revisar `ADMIN_EMAILS`, `profiles`
   com `role='admin'`/`portal_access=true` — um atacante com acesso de
   dashboard pode ter promovido uma conta própria.
6. **VERIFY**: reexecutar `dr_integrity_report()`, revisar
   `pg_policies`/`pg_proc` das funções `SECURITY DEFINER` críticas
   (`is_portal_admin`, `admin_delete_user`) por alteração não
   autorizada.
7. **RETURN TO SERVICE**: SEV-1 + fluxo de data breach LGPD se dado
   pessoal foi exposto (`INCIDENT_RESPONSE.md §5`).

### E. GitHub compromise

1. **DETECT**: commit/push não reconhecido, workflow alterado,
   branch protection desabilitada, PAT/token vazado.
2. **STOP**: revogar o token/PAT comprometido imediatamente (GitHub →
   Settings → Developer settings → PATs, ou Settings → Applications
   para OAuth apps). Se for conta de usuário: forçar logout de todas
   as sessões (GitHub → Settings → Sessions).
3. **PRESERVE**: **não fazer force-push nem deletar branches** antes de
   capturar evidência — `git log`, lista de workflow runs recentes,
   diff de `.github/workflows/*` contra o último commit confiável.
4. **RESTORE**: identificar o último commit "known-good" (antes da
   atividade suspeita) e criar uma branch nova a partir dele; **não
   sobrescrever `main` até confirmar** que não há trabalho legítimo
   perdido no meio. Se `main` foi corrompida/force-pushed
   maliciosamente: qualquer clone local íntegro (inclusive o desta
   sessão) serve de fonte para reconstruir — mas confirme que o clone
   é anterior ao compromise.
5. **RECONCILE**: revisar TODOS os secrets do repo como comprometidos
   por padrão (ver Secret Recovery Matrix) — rotacionar
   `CLOUDFLARE_API_TOKEN` no mínimo, já que ele vive em GitHub Actions
   secrets.
6. **VERIFY**: branch protection ainda ativa no `main` (MANUAL
   VERIFICATION — checar via `gh api` ou UI), workflows voltaram ao
   conteúdo esperado (comparar hash SHA-pinning dos actions de
   terceiros, per `SECURITY_AUDIT_LOG.md`).
7. **RETURN TO SERVICE**: revisar `security.yml`/`codeql.yml` rodaram
   limpo no commit restaurado.

### F. Cloudflare compromise

1. **DETECT**: deploy não reconhecido, DNS alterado, Pages project
   deletado/modificado.
2. **STOP**: revogar `CLOUDFLARE_API_TOKEN` no Cloudflare Dashboard
   imediatamente; trocar senha da conta + revisar sessões ativas.
3. **PRESERVE**: capturar screenshot/export dos registros DNS atuais
   ANTES de qualquer correção (não existe export de DNS versionado
   neste repo hoje — ver Findings/recomendação).
4. **RESTORE DNS**: comparar contra o inventário de registros
   críticos abaixo (§DNS Record Inventory) e corrigir manualmente
   qualquer registro alterado.
5. **RESTORE Pages**: se o projeto Pages foi deletado, recriar
   (`queroumacor-next`/`queroumacorapp`) e reconectar ao repo GitHub —
   o histórico de deployments antigo não é recuperável, mas o CÓDIGO
   está no GitHub (fonte de verdade).
6. **RECONCILE**: gerar novo `CLOUDFLARE_API_TOKEN` com o MESMO escopo
   mínimo (`Cloudflare Pages:Edit`) e atualizar em GitHub Actions
   secrets.
7. **VERIFY**: `/api/health` 200, DNS resolve certo (`dig`/`nslookup`
   externos, fora do container — egress bloqueado aqui), TLS válido.
8. **RETURN TO SERVICE**: monitorar propagação DNS (TTL).

### G. Payment provider outage (Mercado Pago fora do ar)

1. **DETECT**: checkout falhando, webhook não chega.
2. **STOP**: nada a parar — o app já não marca nada como pago sem
   confirmação do provider (confirmado: nenhum código seta
   `status:'paid'`/`is_pro:true` otimisticamente antes do webhook).
3. **PRESERVE**: —
4. **RESTORE**: aguardar o provider voltar; não há dependência de
   infra nossa a restaurar.
5. **RECONCILE**: quando o MP voltar, ele reenvia webhooks pendentes —
   o handler trata MP como fonte de verdade (`GET /v1/payments/{id}`
   ao vivo a cada evento, não só o payload do webhook), então o
   catch-up é automático e seguro, incluindo depois de um restore de
   banco (ver `DR_AUDIT_2026-09-17.md` §Payments).
6. **VERIFY**: checkout volta a completar; `invoices`/`orders`
   convergem com o extrato do MP.
7. **RETURN TO SERVICE**: —

### H. Restore de backup de 24h atrás (tabletop completo)

Ver seção dedicada abaixo, [Restore de 24h — tabletop](#restore-de-24h-atrás--tabletop).

---

## Restore de 24h atrás — tabletop

Cenário: PITR restaura o banco para T0 = agora−24h. **O que se perde
sem reconciliação, e como reconciliar:**

| Domínio | O que se perde ao voltar 24h | Reconciliação |
| --- | --- | --- |
| **Pagamentos (Mercado Pago)** | `orders`/`invoices`/`is_pro` voltam ao estado de 24h atrás | **Seguro por design**: o webhook handler consulta a API do MP ao vivo (`GET /v1/payments/{id}`, `GET /preapproval/{id}`) a cada evento — trata o MP como fonte de verdade, não o payload armazenado. Reenviar/reprocessar os webhooks das últimas 24h re-aplica o estado correto sem duplicar (idempotência por `external_id` via `upsert_invoice`). |
| **Exclusões de conta/conteúdo** | Contas excluídas nas últimas 24h **voltam ativas**; posts/comentários moderados/soft-deletados **reaparecem** | **NÃO é automático hoje.** Consultar `deletion_tombstones` (se a migration `2026-09-17-dr-deletion-tombstone-and-integrity.sql` já tiver rodado antes do disaster) + qualquer registro externo (Sentry, se a mudança de código desta auditoria foi deployada) para a lista de `entity_id` excluídos entre T0 e o disaster, e reaplicar a exclusão manualmente (chamar `admin_delete_user`/soft-delete de novo para cada um). **Gap conhecido e documentado**: se nenhum registro externo existir, não há como saber quem foi excluído nesse intervalo — ver Finding correspondente. |
| **Mensagens WhatsApp** | `whatsapp_messages` volta 24h; `opted_out`/`opted_out_at` de quem pediu PARE nesse intervalo pode reverter | **Risco real, HIGH**: se o Meta/Dualhook reenviar (retry) ou o cliente mandar nova mensagem depois do restore, o runner pode tratá-lo como opt-in de novo. Antes de reabrir o canal, `SELECT` manualmente quem tem `opted_out_at`/mensagem com texto "PARE" nos logs do Dualhook (fora do nosso banco) das últimas 24h e reaplicar opt-out. **Nunca reenviar follow-up automaticamente logo após um restore** — pausar `whatsapp_ai_config` até essa checagem terminar. |
| **Mídia/uploads** | Arquivo enviado nas últimas 24h fica órfão no Storage (sem linha no banco) OU referência no banco aponta pra Storage que não rolou junto | Rodar `dr_integrity_report()`; **não** rodar `execute_cleanup_orphan_media()` até confirmar (ver aviso principal). |
| **Webhooks (Meta, MP, Evolution legado)** | Efeito duplo: (a) eventos processados nas últimas 24h "desaparecem" do nosso lado; (b) reenvio do provider pode ou não ser seguro | MP: seguro (ver acima). WhatsApp: `message_id UNIQUE` faz o reenvio ser idempotente para a MENSAGEM em si, mas não protege contra a IA/follow-up re-agir a estado (opt-out) perdido — ver linha acima. |
| **Push** | Notificações das últimas 24h não existem mais | **Seguro**: triggers são `AFTER INSERT`, não reprocessam em restore (não há "fila" de push pendente que reenvie sozinha). |
| **Cota de IA / pontos / rate limits** | Contadores voltam 24h (usuário "recupera" cota/rate-limit já gasto) | LOW — abuso limitado, não perda de dado nem duplicação financeira. Não requer ação. |
| **Auditoria (`audit_log`)** | Trilha das últimas 24h desaparece — inclusive a trilha da PRÓPRIA exclusão de contas desse intervalo | **HIGH** — sem cópia externa, esse gap é definitivo. Ver Finding "audit trail sem backup externo". |

**Conclusão do tabletop**: um restore de 24h é tecnicamente simples
(PITR do Supabase) mas **não é seguro declarar "recuperado" sem**: (1)
rodar `dr_integrity_report()`, (2) conferir contas/conteúdo excluído no
intervalo via `deletion_tombstones` + qualquer log externo, (3) pausar
IA/WhatsApp automático até confirmar opt-outs, (4) NÃO rodar limpeza de
mídia órfã. Pagamento é o único domínio com reconciliação automática
segura hoje.

---

## Smoke Test mínimo pós-restore

Não declarar sistema recuperado só porque a home abre. Rodar, nesta
ordem:

1. `GET /api/health` → 200.
2. Signup/login (conta de teste) funciona.
3. Feed carrega (posts + avatares).
4. Publicar um post (imagem) funciona.
5. Enviar uma mensagem de chat (1:1) funciona.
6. Upload de mídia (avatar ou post) funciona e a URL resultante abre.
7. Fluxo de pagamento em modo mock/staging (não produção real) —
   confirmar que o checkout ao menos gera a preferência sem erro.
8. Rota de IA (ex. `/api/chat-ai` com prompt trivial) responde ou
   retorna 503 explícito (não 500 cru).
9. Push: registrar um token de teste não quebra.
10. `select * from public.dr_integrity_report();` sem `fail`.
11. RLS: reconfirmar que uma tabela sensível (`leads`, `quotes`) nega
    acesso a um usuário sem `is_portal_admin()`.

---

## DNS Record Inventory (documentar, não versionado hoje)

**MANUAL VERIFICATION / recomendação**: não existe export de zona DNS
versionado neste repo (confirmado — sem Terraform/`wrangler.toml` com
registros DNS). Recomenda-se (não implementado aqui, decisão
operacional do usuário): exportar a zona Cloudflare periodicamente
(Dashboard → DNS → Export, ou API) e guardar fora do repo público (ex.
gerenciador de senhas ou repo privado separado — nunca junto do código
público, por serem registros operacionais sensíveis a phishing/DNS
hijacking se vazados combinados com outros dados). Registros
conhecidos por menção em código/docs (não uma lista exaustiva — a
lista completa só existe no Dashboard):
- `queroumacor.com.br` (apex) → Cloudflare Pages.
- `www.queroumacor.com.br` (usado no host de deep link Android/App
  Links, per CLAUDE.md).
- `app2.queroumacor.com.br` (reservado para eventual cutover do
  `next-app`, ainda não em uso segundo `RUNBOOK.md §3`).
- `_dmarc.calicolors.com.br` — **conhecido AUSENTE** (achado de
  auditoria anterior, não repetir).
- DNSSEC (`queroumacor.com.br`, `.com.br`/Registro.br) — ligado no
  Cloudflare, DS record pendente no registrador (per CLAUDE.md,
  2026-09-16) — não é achado novo desta auditoria.

---

## Reconciliation Matrix

| Domínio | Fonte de verdade | O que pode divergir | Método de recuperação | Status |
| --- | --- | --- | --- | --- |
| Auth/Profile | Supabase Auth (`auth.users`) | `profiles` pode ficar sem linha correspondente se `handle_new_user` falhar (exceção engolida, `RAISE WARNING`) | Backfill manual (já feito uma vez, per CLAUDE.md); `dr_integrity_report()` checa `profiles_without_auth_user` | Parcialmente coberto — checagem nova, correção ainda manual |
| Pagamento (Mercado Pago) | Mercado Pago (API ao vivo) | `orders`/`invoices` local desatualizado | Reprocessar webhook — código já consulta o MP ao vivo por evento, auto-reconciliável | **Coberto** |
| Storage/DB (mídia) | Ambíguo — nenhum dos dois é canônico sozinho: DB tem a referência, Storage tem o byte | Referência quebrada nos dois sentidos | `dr_integrity_report()` (nova, direção DB→Storage) + `cleanup_orphan_media()` (existente, direção Storage→DB) — **nunca rodar a segunda logo após restore** | Parcial — direção DB→Storage cobrida nesta auditoria; sem backup de Storage confirmado (MANUAL VERIFICATION) |
| Webhooks (WhatsApp/Meta) | Meta/Dualhook (mensagens) | `whatsapp_messages` desatualizada; `opted_out`/IA state pode reverter | `message_id UNIQUE` cobre duplicação de mensagem; opt-out **não tem reconciliação automática** — checar manualmente antes de reabrir canal automático | **Gap HIGH**, documentado, não corrigido nesta sessão (exigiria acesso ao log do Dualhook, fora do repo) |
| Push | Nenhuma persistência de "fila pendente" — trigger-driven | N/A (nada para divergir; se perdido, simplesmente não reenviou) | N/A | **Seguro por design** |
| Exclusão de conta | Ação do usuário/admin, registrada em `audit_log` (mesma DB) | Restore anterior à exclusão resssucita a conta | `deletion_tombstones` (nova, mesma DB — mesma limitação de restore) + recomendação de espelhar em Sentry (não implementado — decisão de produto) | **Gap HIGH**, mitigado parcialmente nesta auditoria (ledger imutável), correção completa requer decisão de produto sobre replicação externa |
| CSAM hash blocklist | `media_hash_blocklist` (mesma DB) | Restore anterior a um bloqueio reverte a proteção | **Nenhuma automática.** Ver Finding CRITICAL — decisão de produto necessária, não implementada por sensibilidade legal (ver Findings) | **CRITICAL, sem correção automática — BUSINESS DECISION REQUIRED** |

---

## Referências

- [`DR_AUDIT_2026-09-17.md`](./DR_AUDIT_2026-09-17.md) — relatório completo,
  matrizes, findings classificados, verification checklist.
- [`RUNBOOK.md`](./RUNBOOK.md) — deploy/rollback rotineiro.
- [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) — severidades, LGPD.
- [`CSAM_POLICY.md`](./CSAM_POLICY.md) — política de moderação CSAM.
- `/migrations/2026-09-17-dr-deletion-tombstone-and-integrity.sql` —
  SQL desta auditoria (ainda **NÃO EXECUTADO** — colar no SQL Editor).
