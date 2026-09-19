# Incident Response Plan — QueroUmaCor

> Plano formal de resposta a incidentes operacionais e de segurança.
> Complementa [`RUNBOOK.md`](./RUNBOOK.md) (procedimentos rotineiros) e
> [`../DEPLOYMENT.md`](../DEPLOYMENT.md) (referência de deploy).

---

## 1. Severidades

| Sev   | Definição                                                                       | SLA ack | SLA fix    |
| ----- | ------------------------------------------------------------------------------- | ------- | ---------- |
| SEV-1 | Produção indisponível pra todos usuários (site fora, login quebrado em massa)   | 15 min  | 4 h        |
| SEV-2 | Feature crítica quebrada pra muitos usuários (chat, pagamento, upload, signup)  | 30 min  | 1 dia      |
| SEV-3 | Feature secundária quebrada / spike de erros em Sentry (>1%) / regressão visual | 4 h     | 1 semana   |
| SEV-4 | Bug menor / cosmético / edge case afetando <0.1% dos usuários                   | next sprint | next sprint |

**Data breach** (vazamento de dados pessoais sob LGPD) — tratada como
SEV-1 com fluxo dedicado em [§5](#5-resposta-data-breach-lgpd).

---

## 2. Detecção

Canais por onde um incidente pode chegar:

- **Sentry**: issue nova / spike em error rate (sem alert
  configurado ainda — checar dashboard manualmente).
- **Usuário reporta** via WhatsApp `(11) 95976-5031` ou email
  `loja@calicolors.com.br`.
- **Health check fail**: workflow `.github/workflows/uptime.yml`
  ping em `/api/health` falha → notifica via Actions.
- **Mercado Pago webhook fail**: pagamento não processa → cliente
  reclama, ou aparece em logs Cloudflare Pages Functions.
- **Auditoria interna**: review periódico de logs / Sentry / Web Vitals.
- **Log estruturado de segurança** (2026-09-17): toda linha
  `console.warn/error('[security]', '{"event":"...", "severity":"...",...}')`
  — grep-ável nos logs do Cloudflare Pages Functions por `[security]`.
  Cobre rate-limit hits/fail-open, falha de auth, assinatura de webhook
  inválida, quota de IA excedida, upload rejeitado, mismatch de valor de
  pagamento, escalada de privilégio bloqueada. `severity: 'critical'`
  também abre uma Issue no Sentry (mesmo projeto já conectado, sem
  alerting configurado — ver limitação abaixo). Ver taxonomia completa em
  `lib/api/securityEvents.ts` e §10 abaixo.
- **`audit_log`/`audit_events`** (Supabase): trilha de ações
  administrativas (`audit_log`) e diffs automáticos old→new de
  is_pro/portal_access/role + tentativas de escalada bloqueadas
  (`audit_events`) — consultável por SQL, só admin lê via RLS.

Threshold orientativo (sem alert automatizado ainda):

- Sentry error rate > 1% nos últimos 5 min → investigar.
- `/api/health` retornando não-200 → SEV-1.
- Sentry issue NOVA com >50 ocorrências em <10 min → SEV-1 ou SEV-2.
- Proposta de regra de detecção (não implementada como alerta automático —
  ver "Detection rules" no relatório da auditoria de 2026-09-17): 20
  `auth.login.failed` por IP em 5 min E >5 contas distintas envolvidas →
  suspeita de credential stuffing (distinto de brute force numa única
  conta, que é volume alto contra o MESMO email/IP).

---

## 3. Resposta SEV-1

Sequência ordenada pra recuperar produção rápido. Owner principal:
Jackson (`jackson.guerra@gmail.com`).

1. **Confirma o incidente**:
   - Erro reproduzido manualmente?
   - Sentry Issues — quantos usuários afetados (sessions)?
   - `/api/health` retorna 200?
   - Console em produção tem erro JS no boot?
2. **Comunica**:
   - Status interno: WhatsApp de devs (se houver) ou nota mental.
   - Status externo: se a interrupção passar de 30 min, postar aviso
     no Instagram/feed do app (banner via `announcements`).
3. **Mitiga primeiro, corrige depois**:
   - **Rollback rápido** via
     [`RUNBOOK.md` §5](./RUNBOOK.md#5-rollback-rápido).
   - `.github/workflows/rollback.yml` ou CF Pages Dashboard.
   - Aceitar rollback de uma feature nova pra restaurar serviço.
4. **Investiga**:
   - Sentry stack trace (com Code Mappings GitHub).
   - Logs Cloudflare Worker (Dashboard → Pages → Functions → Logs).
   - Logs Supabase (Dashboard → Logs → API/Auth/Database).
   - Modal `/admin/errors` (tabela `errors` caseira).
   - Replay de sessão no Sentry (Session Replay ativo).
5. **Corrige**:
   - Branch `hotfix-<descrição>` → PR pra `main` → merge.
   - Deploy automático (~90s).
6. **Verifica**:
   - Sentry mostra erro baixando ou cessando.
   - `/api/health` 200.
   - Smoke test manual em queroumacor.com.br.
7. **Post-mortem** em até 24h:
   - Documenta em `SECURITY_AUDIT_LOG.md` (se segurança) ou
     em novo `docs/incidents/INCIDENT-YYYY-MM-DD.md` (se ops).
   - Inclui: timeline, root cause, mitigação aplicada, ação
     preventiva (teste novo? alert novo? renomeio?).

---

## 4. Resposta SEV-2 / SEV-3 / SEV-4

- **SEV-2**: mesmo fluxo de SEV-1, mas com janela mais larga. Não
  necessariamente rollback — pode esperar fix forward se for
  trivial.
- **SEV-3**: priorizar no próximo deploy regular. Documentar issue
  no GitHub se reproduzível.
- **SEV-4**: backlog. Adicionar em [`../BACKLOG.md`](../BACKLOG.md).

---

## 5. Resposta data breach (LGPD)

LGPD (Lei Geral de Proteção de Dados) brasileira. Lei 13.709/2018.
Obrigatório quando dado pessoal de usuário brasileiro é exposto ou
acessado indevidamente.

### Definição

- **Dado pessoal**: nome, email, CPF, telefone, foto, endereço, IP,
  qualquer identificador.
- **Vazamento**: acesso, exposição, modificação, perda, destruição
  não autorizada.

### Fluxo obrigatório

1. **Contém o vazamento** imediatamente:
   - Revogar tokens/chaves expostas (Supabase service_role → rotacionar
     conforme [`RUNBOOK.md` §7.2](./RUNBOOK.md#72-rotacionar-supabase-service_role-key)).
   - Bloquear endpoint vulnerável (deploy patch ou desabilitar
     temporariamente via `_redirects`).
   - Revogar sessões Supabase Auth se aplicável.
2. **Identifica escopo** (em até 4h):
   - Quantos usuários afetados.
   - Quais campos vazaram.
   - Janela temporal do vazamento.
   - Lista de IDs/emails afetados (via Supabase SQL).
3. **Notifica DPO** (`dpo@calicolors.com.br`) em até 24h da detecção.
4. **Notifica ANPD** em até 72h (LGPD art. 48 — prazo "razoável",
   recomendação prática 72h).
   - Formulário: https://www.gov.br/anpd/pt-br
   - Inclui: descrição do incidente, dados afetados, número de
     titulares, medidas tomadas, contato do DPO.
5. **Notifica usuários afetados** quando aplicável (LGPD art. 48 §1).
   - Critério: risco/dano relevante aos titulares.
   - Canal: email + aviso in-app via `announcements`.
6. **Documenta**:
   - Cria `docs/incidents/INCIDENT-YYYY-MM-DD-data-breach.md`.
   - Anexa em `SECURITY_AUDIT_LOG.md`.
   - Mantém registro por mínimo 5 anos (recomendação ANPD).

### Casos comuns

- **Supabase RLS policy errada** expondo `profiles.email` sem
  autenticação → mitigação: corrigir policy, notificar quem usou a
  janela.
- **Service role key vazada** em commit ou log → rotacionar
  imediatamente (ver `RUNBOOK.md`).
- **`me-export` retornando dados de outro usuário** → bug crítico,
  parar endpoint até patch.

---

## 6. Rollback rápido (resumo)

Procedimento completo em
[`RUNBOOK.md` §5](./RUNBOOK.md#5-rollback-rápido).

- **Código**: GitHub Actions `Rollback main` (confirm=ROLLBACK,
  target_sha opcional) OU CF Pages Dashboard → "Rollback to this
  deployment".
- **Banco**: Supabase PRO PITR 7 dias.

---

## 7. Contatos

| Função                  | Quem / canal                                      |
| ----------------------- | ------------------------------------------------- |
| Owner / on-call         | Jackson Guerra (`jackson.guerra@gmail.com`)       |
| DPO (LGPD)              | `dpo@calicolors.com.br`                           |
| Atendimento usuários    | `loja@calicolors.com.br` / WhatsApp `(11) 95976-5031` |
| Supabase Support        | dashboard.supabase.com → Support (plano PRO)      |
| Cloudflare Support      | support.cloudflare.com (plano PRO — chat 24/7)    |
| Sentry Support          | sentry.io → Support / Help                        |
| Mercado Pago Support    | mercadopago.com.br/suporte                        |
| ANPD (data breach)      | https://www.gov.br/anpd                           |
| Hostname produção       | `queroumacor.com.br`                              |
| Hostname staging        | `<branch>.queroumacorapp.pages.dev`               |
| Hostname Next.js (TBD)  | `app2.queroumacor.com.br`                         |

---

## 8. Pós-incidente

Em até 24h após resolução (SEV-1 / SEV-2) ou no fim da sprint
(SEV-3):

1. Cria `docs/incidents/INCIDENT-YYYY-MM-DD-<slug>.md` com:
   - **Timeline** (detecção → mitigação → fix → verificação).
   - **Root cause** (a real, não a sintomática).
   - **Impacto** (usuários afetados, duração, dado perdido se houver).
   - **Mitigação** aplicada (rollback? patch? config change?).
   - **Ação preventiva**:
     - Teste novo? Adicionar em `tests/` ou `e2e/`.
     - Alert novo? Sentry / health check / log alert.
     - Refactor? Adicionar em [`../BACKLOG.md`](../BACKLOG.md).
2. Atualiza [`../SECURITY_AUDIT_LOG.md`](../SECURITY_AUDIT_LOG.md) se
   for incidente de segurança.
3. Compartilha com o usuário (Jackson) — se descoberto algo que
   afeta convenções de futuro, atualiza
   [`../CLAUDE.md`](../CLAUDE.md).

---

## 9. Limitações conhecidas

- **Sem alerting automatizado em Sentry** ainda. Detecção depende
  de check manual ou usuário reportar. Backlog: configurar Sentry
  alert (email + threshold por error rate).
- **Sem status page pública** (statuspage.io, Better Uptime, etc.).
  Comunicação externa é via Instagram/WhatsApp ad-hoc.
- **Egress do container Claude bloqueia `queroumacor.com.br`** —
  Claude não consegue confirmar resolução do incidente por `curl`.
  Verificação real precisa vir do usuário ou dashboards externos.
- **MCP Supabase aponta pra projeto errado** — Claude não consegue
  rodar SQL de mitigação direto. Procedimento: colar SQL no chat,
  usuário roda no SQL Editor.
- **Sem secondary on-call** — única pessoa de plantão é Jackson. Em
  caso de indisponibilidade, fallback é rollback automático (CF
  Pages Dashboard funciona sem ele).

---

## 10. Runbooks por tipo de credencial/incidente

Auditoria de observabilidade de segurança (2026-09-17): os passos abaixo
são o "o que fazer" quando o sinal de detecção (Sentry, `/admin/errors`,
`audit_log`/`audit_events`, log estruturado `[security] {...}`) aponta pra
cada classe de incidente. Nenhum destes é executado automaticamente por
código — são procedimentos MANUAIS pro humano de plantão.

### 10.1 Vazamento de API key (Gemini/OpenAI/MP/Dualhook/VAPID/etc.)

1. Identifica QUAL chave (o `.gitleaks.toml`/`.gitleaksignore` documentam o
   único caso histórico conhecido — chave Gemini em commit antigo, já
   confirmado sem uso ativo; qualquer achado NOVO segue este runbook).
2. Desabilita/revoga no painel do provedor (Google AI Studio, OpenAI
   platform, Mercado Pago, Dualhook).
3. Gera a nova chave e atualiza a env no Cloudflare Pages (Settings →
   Environment Variables) — ver `RUNBOOK.md` §7.5.
4. **Retry deployment** (env var não propaga sem novo deploy).
5. Procura uso indevido: `grep` por chamadas com a chave antiga não é
   possível daqui (chave nunca fica em log, por desenho — ver §26 da
   auditoria), então a evidência é indireta: pico de custo/uso na conta do
   provedor na janela em que a chave esteve exposta.
6. Revisa `audit_log`/logs estruturados `security.ai.*` no período.
7. Documenta em `SECURITY_AUDIT_LOG.md`.

### 10.2 Vazamento de `SUPABASE_SERVICE_ROLE_KEY`

Impacto potencial ALTO — bypassa toda RLS. Procedimento completo já existe
em `RUNBOOK.md` §7.2 ("Rotacionar Supabase service_role key"); resumo:

1. Supabase Dashboard → rotate.
2. Atualiza a env nos DOIS projetos CF Pages (`queroumacorapp` e
   `queroumacor-next`, se existir).
3. Retry deployment nos dois.
4. Smoke test dos endpoints service-role (admin, mp-webhook, me-export,
   upload-style-ref, log-error, push-notify).
5. Verifica `security.config.service_role_missing` (log estruturado) não
   voltou a disparar após o redeploy — se disparou, a env não propagou.
6. Revisa `audit_log` no período pra qualquer ação administrativa que não
   se explica por um admin conhecido.

### 10.3 Conta/token do GitHub comprometida

Confiar no **GitHub Audit Log** (Settings → Organização → Audit log,
MANUAL VERIFICATION — não acessível deste ambiente) pra:

1. Revogar sessões/tokens (Settings → Applications → Authorized OAuth
   Apps / Personal access tokens).
2. Inspecionar commits e workflows recentes por autor suspeito
   (`git log --all --author=<...>`, revisar `.github/workflows/*.yml` por
   diffs não solicitados — mudança em workflow é sempre rastreável via Git,
   nunca invisível).
3. Desabilitar deploy: `deploy.yml` só dispara por `workflow_dispatch` com
   `if: github.ref == 'refs/heads/main'` — revogar o `CLOUDFLARE_API_TOKEN`
   (10.4) já corta a capacidade de publicar, independente do GitHub.
4. Rotacionar credenciais de deploy (10.4) e qualquer secret do repo que a
   conta comprometida pudesse ter lido (Settings → Secrets — segredos não
   são re-exibidos, mas se a conta tinha permissão de Actions admin,
   assumir todos como potencialmente vistos e rotacionar).
5. Inspecionar artifacts publicados recentemente (SBOM, screenshots) por
   conteúdo inesperado.
6. Documentar em `SECURITY_AUDIT_LOG.md` com o Audit Log do GitHub como
   evidência anexada.

### 10.4 Token do Cloudflare (`CLOUDFLARE_API_TOKEN`)

1. Cloudflare Dashboard → My Profile → API Tokens → revoke.
2. Gera novo com o MESMO escopo mínimo já documentado (`Cloudflare
   Pages:Edit`, nada mais — ver `SECURITY_AUDIT_LOG.md`, auditoria de
   2026-09-16/17).
3. Atualiza o secret `CLOUDFLARE_API_TOKEN` no GitHub (Settings → Secrets
   and variables → Actions).
4. Verifica no CF Dashboard → Deployments se houve deploy/config change
   fora da janela esperada.
5. Confirma `deploy.yml` continua com `if: github.ref ==
   'refs/heads/main'` (não foi alterado pra permitir deploy de outra ref).

### 10.5 Service account do Firebase/GCP comprometida

1. Google Cloud Console → IAM & Admin → Service Accounts → a chave → Delete
   (não só desabilitar).
2. Revisar Cloud Audit Logs (GCP) — MANUAL VERIFICATION, fora deste
   ambiente — por uso da chave na janela de exposição.
3. Criar chave nova com o MESMO princípio de least-privilege já em uso
   (`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` só têm permissão de envio FCM —
   ver auditoria FCM/push, 2026-09-13).
4. Atualizar `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` no CF
   Pages + retry deployment.
5. Revisar `push_device_tokens`/notificações enviadas na janela suspeita.

### 10.6 Chave APNs (`.p8`) comprometida

1. Apple Developer → Certificates, Identifiers & Profiles → Keys → revoke
   a Key ID atual (`2R6FW9F2F6`, ver CLAUDE.md).
2. Gerar nova Auth Key, subir no Firebase Console (Cloud Messaging → Apple
   app configuration), nos dois slots (Sandbox & Production).
3. Build iOS seguinte precisa rodar DEPOIS dessa troca (o provisioning é
   gerado durante a build — mesma regra já documentada no CLAUDE.md pra
   mudança de capability).

### 10.7 Account takeover (conta de usuário comum)

Sinais: `auth.login.failed` repetido pro mesmo email seguido de sucesso de
IP/device diferente; mudança de email/senha fora do padrão de uso.

1. Supabase Dashboard → Authentication → Users → o usuário → revoke
   sessions (ou via SQL: invalidar refresh tokens).
2. Verificar em `audit_events`/`profiles` se houve mudança de
   role/is_pro/portal_access no período (a trigger `protect_profile_columns`
   bloqueia escalada por usuário comum, então isso não é o vetor — o risco
   real é dano ao PRÓPRIO conteúdo/dados da vítima: posts, mensagens,
   pedidos).
3. Notificar o usuário (LGPD — ver §5) se dados foram expostos/alterados.

### 10.8 Admin comprometido (o cenário mais grave de app-level)

1. **Revoke sessions** do admin (Supabase Auth).
2. Desabilitar a conta: `is_portal_admin()` cai automaticamente se
   `portal_access`/`role='admin'` for revertido — usar o portal (outro
   admin) ou SQL direto: `UPDATE profiles SET portal_access=false, role='pintor' WHERE id='<uuid>';`
   (SQL fica pro chat, usuário roda — regra padrão deste repo).
3. Revisar `audit_log` (ações via `/api/admin/users`) E `audit_events`
   (agora com `security.role_change`/`security.privilege_escalation_blocked`
   — ver migration `2026-09-17-security-observability-audit-trail.sql`) pra
   TODAS as ações desse `actor_id` desde quando a conta foi comprometida.
4. Reverter mudanças maliciosas identificadas (promoções indevidas,
   `set_pro` em massa, exclusões) — usar o old-value que os dois trails
   agora capturam.
5. Se a conta comprometida promoveu OUTRA conta a admin, revogar a segunda
   também.

### 10.9 Abuso de pagamento (Mercado Pago)

1. `security.payment.amount_mismatch` / `security.webhook.invalid_signature`
   (provider=mercadopago) no log estruturado são o primeiro sinal.
2. Congela a ativação automática de PRO se o padrão persistir: não existe
   feature flag dedicada hoje (achado da auditoria — ver §Kill switches
   abaixo); a mitigação manual é reverter `MP_WEBHOOK_ENFORCE=true` (já
   fail-closed sem secret) e, em último caso, remover temporariamente
   `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` do CF Pages pra `/api/mp-webhook`
   passar a rejeitar tudo (fail-closed já documentado no código).
3. Reconciliar com o painel do Mercado Pago (transações reais vs. o que o
   `orders`/`audit_events` registram).
4. Preservar `audit_log`/`audit_events` do período — não apagar.

### 10.10 Abuso de WhatsApp (spam/flood)

1. Sinal: `security.rate_limit.hit` (endpoint `whatsapp-send`) ou
   `security.whatsapp.send_failed` em volume.
2. Kill switch manual: remover `DUALHOOK_API_KEY` do CF Pages faz
   `isWhatsAppConfigured()` retornar false e a rota responder 503 pra TODO
   envio (não há flag granular por conversa/admin hoje — achado da
   auditoria).
3. Preservar `whatsapp_messages`/`audit_log` (event ids, não conteúdo) como
   evidência.
4. Investigar qual `actorId` (admin) ou lead está associado ao volume.

### 10.11 Abuso de custo de IA

1. Sinal: `security.ai.quota_exceeded` repetido pro mesmo `userId`/feature.
2. Mitigação imediata: `plan_limits` (tabela) pode ser reduzida por SQL pro
   plano afetado sem precisar de deploy.
3. Não há kill switch dedicado por feature/modelo hoje — remover a env da
   respectiva API key (Gemini/OpenAI) desliga TODAS as features de IA que
   dependem dela (drástico, mas é o que existe).
4. Revisar `ai_usage`/`ai_usage_this_month` pra escopo do abuso.

### 10.12 Vazamento de dados (data leak)

Ver §5 (Resposta data breach/LGPD) — é o mesmo fluxo. Diferencial deste
runbook: usar os logs estruturados novos (`security.rate_limit.hit` em
massa num endpoint que serve PII, `security.upload.rejected` em massa) pra
estimar ESCOPO (quantas tentativas, de qual IP/janela) mais rápido do que
só a tabela afetada permitiria.

### Kill switches — o que existe hoje (achado da auditoria, 2026-09-17)

**Não existe um flag central "desligar AI/WhatsApp/push/payments/uploads"**
— o que existe são checagens de presença de credencial (ausência de
`DUALHOOK_API_KEY`/`OPENAI_API_KEY`/`MP_ACCESS_TOKEN`/service-role key faz
a respectiva rota falhar fail-closed). Pra usar isso como kill switch de
INCIDENTE, o procedimento é remover a env correspondente no CF Pages +
retry deployment — funciona, mas é uma ação de configuração de painel, não
um botão dedicado. `feature_flags`/`is_feature_enabled` existem no banco
mas só gateiam rollout de UI (`ai_voice_chat`, `story_video`,
`mp_checkout_loja`, etc.), nenhuma rota de servidor consulta essas flags
hoje. Se um botão de emergência dedicado (sem precisar de deploy) se
tornar prioridade, é trabalho futuro — não implementado nesta auditoria
por ser mudança de arquitetura, não observabilidade.
