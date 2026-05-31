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

Threshold orientativo (sem alert automatizado ainda):

- Sentry error rate > 1% nos últimos 5 min → investigar.
- `/api/health` retornando não-200 → SEV-1.
- Sentry issue NOVA com >50 ocorrências em <10 min → SEV-1 ou SEV-2.

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
