---
tags: [segurança, auditoria, logging, observabilidade, audit-trail]
---

# Auditoria de Security Logging / Monitoring / Alerting / Audit Trails

**Data:** 2026-09-17, PR #331, branch `claude/optimistic-davinci-h2ol1l`, mergeada 2026-09-19. SQL `/migrations/2026-09-17-security-observability-audit-trail.sql` — **JÁ EXECUTADO** no Supabase (2026-09-20, confirmado pelo usuário: `tentativa_bloqueada_e_auditada=true`, `role_change_auditado=true`, `crons_agendados_esperado_3=3`). **Não pedir pra rodar de novo.**

Pergunta que guiou a auditoria: *"se alguém atacar ou abusar do sistema, conseguimos perceber, investigar e reconstruir sem vazar dado sensível?"*.

## Vários caminhos de segurança eram 100% silenciosos
Rate-limit hits, negação de quota de IA, rejeição de upload, assinatura de webhook inválida (WhatsApp e Mercado Pago), falha de envio de WhatsApp — e o mais grave, **tentativa de auto-escalada de privilégio (`role`/`is_pro`/`portal_access`) era revertida pelo trigger `protect_profile_columns` sem deixar rastro nenhum.** Agora a tentativa BLOQUEADA é gravada em `audit_events` (`security.privilege_escalation_blocked`) antes de ser revertida — mesmo comportamento de bloqueio, só ganhou trilha.

## `audit_profile_changes` nunca cobriu mudança de `role`
Só `is_pro`/`portal_access` tinham trilha old→new. Promoção/rebaixamento de admin feito por um admin de verdade (via `/api/admin/users`) não tinha registro nenhum de qual era o valor ANTERIOR. Agora `security.role_change` grava old_role/new_role.

## Helper novo `lib/api/securityEvents.ts`
Log estruturado (JSON de uma linha), convenção `dominio.assunto.verbo`, redação de secret por chave + PII por conteúdo (email/telefone/CPF/CNPJ/JWT/Bearer), defesa contra log injection, correlação por `x-request-id`, nunca lança. Plugado em `checkRateLimit`/`rejectOversizedBody`/`gateAiUsage`/`requireAuth`/webhooks do WhatsApp e MP/envio de WhatsApp.

## Sentry `beforeSend` estendido
Passou a filtrar também `breadcrumbs`, `request.url` (remove query string/fragment), `request.query_string` e `request.headers` (Authorization/Cookie → `[REDACTED]`) — antes só mascarava `user.email`/`request.data`/`extra`/`contexts`. (A auditoria Bloco 21, alguns dias depois, ainda achou uma lacuna nessa cadeia — ver [[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]]: `exception.values[].value`/`message` continuavam sem máscara.)

## `docs/INCIDENT_RESPONSE.md` novo
Runbooks §10.1–§10.12 por tipo de credencial/incidente (API key, service-role, GitHub, Cloudflare, Firebase, APNs, account takeover, admin compromise, payment/WhatsApp/AI abuse, data leak) + nota sobre ausência de kill switch central.

## Cleanups agendados
As 3 funções de cleanup (`cleanup_old_audit_events`, `cleanup_old_notifications`, `cleanup_rate_limits`) que já existiam como função mas nunca tinham sido agendadas via pg_cron foram pro ar.

---
## Ver também
[[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]] · [[Segurança - Disaster Recovery e Business Continuity]] · [[Segurança - Identidade Externa e Contas Administrativas]] · [[Segurança - Auditoria Supabase (RLS e Banco)]]
