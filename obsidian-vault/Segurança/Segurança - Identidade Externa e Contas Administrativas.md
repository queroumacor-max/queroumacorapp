---
tags: [segurança, auditoria, iam, mfa, identidade, contas-externas]
---

# Auditoria Externa de Identidade e Contas Administrativas

**Data:** 2026-09-17, branch `claude/inspiring-thompson-yh6hc9`. Diferente das auditorias de RLS/código: aqui o escopo é **IAM/MFA/recovery/break-glass de TODA a infraestrutura externa** (GitHub, Cloudflare, Supabase, GCP/Firebase, Apple Developer, Google Play, Codemagic, Sentry, Meta/WhatsApp/Dualhook, Mercado Pago, Google AI Studio, registrars, e-mail).

Entregue em `docs/EXTERNAL_SECURITY_BASELINE.md` (inventário + matrizes + achados) e `docs/ACCOUNT_RECOVERY_RUNBOOK.md` (break-glass + tabletops + ordem de rotação de emergência). Detalhe completo em `SECURITY_AUDIT_LOG.md`.

## Sessão sem browser/console
Só GitHub via API (verificado: repo é conta pessoal, não org; 2 collaborators — `queroumacor-max` admin/dono, `jacksongmatos` write, nenhum desconhecido; 8 workflows todos com `permissions:` explícito, sem `pull_request_target`, actions de terceiro pinadas por SHA) e o histórico já registrado no CLAUDE.md (verificações de console de sessões anteriores). **Tentou até DNS público (sem login nenhum) via DoH — o proxy de rede do ambiente bloqueou com 403.** Todo o resto (Cloudflare, Supabase, GCP além do já registrado, Apple além do já registrado, Play, Codemagic, Sentry, Meta, Mercado Pago, os 2 registrars) ficou **NOT VERIFIED**, nunca presumido PASS.

## CRITICAL, não corrigido (decisão do usuário): concentração de identidade
`queroumacor@gmail.com` (presumido — é a identidade usada em toda verificação de console já feita) parece concentrar Firebase/GCP, Google AI Studio (INCLUSIVE um projeto de outra empresa, "JR Erp"), Apple Developer Account Holder e provavelmente Cloudflare/Play — **sem 2º admin confirmado em nenhum exceto o Apple** (`beatrisporsebon@icloud.com`, já confirmado intencional em 2026-09-16 — ver [[Segurança - Firebase FCM e Push]]). **Maior single point of failure do sistema.**

## HIGH, achados novos desta auditoria
- **Dualhook** (o proxy que intermedeia TODO o WhatsApp desde 2026-09-05) não estava no inventário de serviços externos do usuário — vendor com acesso total ao número oficial, sem MFA/rotação documentados.
- **Evolution API** (Render, "aposentada" 2026-09-05) tem env vars ainda em `.env.example` e NENHUMA confirmação de que a instância no Render foi desligada/revogada — candidata clássica a serviço esquecido com credencial viva.
- `MP_ACCESS_TOKEN` de produção segue no código sem call-site de UI ativa.

## Resultado
Nada foi rotacionado/revogado/alterado automaticamente. **FINAL STATUS: HIGH ACCOUNT-TAKEOVER RISK** (concentração de identidade + MFA não confirmado em nenhum dos 12 provedores externos críticos + Evolution API dormant não resolvida + nenhum break-glass em nenhum provedor). Ações manuais ficam listadas nos dois documentos novos (`docs/EXTERNAL_SECURITY_BASELINE.md`, `docs/ACCOUNT_RECOVERY_RUNBOOK.md`).

---
## Ver também
[[Segurança - Logging, Observabilidade e Audit Trails]] · [[Segurança - Disaster Recovery e Business Continuity]] · [[Segurança - Firebase FCM e Push]] · [[Pendências Reais (Ação Manual Necessária)]]
