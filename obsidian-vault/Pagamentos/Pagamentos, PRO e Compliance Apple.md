---
tags: [pagamentos, pro, mercado-pago, apple, compliance]
---

# Pagamentos, PRO e Compliance Apple

## Compliance Apple 3.1.3(e) — loja sem pagamento no app (2026-06-18)
A loja Cali Colors NÃO processa pagamento dentro do app. Cliente monta "Lista de Pedido"; loja fecha venda fora do app (WhatsApp). Fluxo Mercado Pago da LOJA (físicos) foi **removido inteiramente**. PRO mantido mas **sem checkout no app** — ativação é MANUAL pela loja (`profiles.is_pro` setado no portal). `billing-platform.ts`/`/api/checkout`/`/api/mp-webhook` continuam no repo intactos, não deletados, caso decidam retomar.
`MP_ACCESS_TOKEN` ainda usado por `/api/checkout` (PRO web) e `/api/mp-webhook` — **não remover a env**.

## Billing platform (C1 do RELEASE_AUDIT)
`lib/services/billing-platform.ts` detecta web/iOS-wrapper/Android-wrapper e roteia pra MP/StoreKit/Play Billing. `/api/play-billing-verify` e `/api/apple-iap-verify` **fail-closed em produção** sem `IAP_PRODUCTION_VERIFICATION_ENABLED=true` (CRIT-1) — não setar até implementar verificação real.

## Grace period e cota de IA (Wave 7, SQL executado)
`profiles.pro_grace_until` + `is_pro_active(uuid)` (considera 3 dias de graça). Tabela `ai_usage` (audit por feature) + `plan_limits` (free=30/pro=500/admin=99999). `gateAiUsage`/`recordAiUsage` em todas as 14 rotas de IA.

## Documentos legais atualizados (2026-09-06)
Privacidade listava Mercado Pago como operador de pagamento do PRO — removido (PRO não passa mais por MP desde 18/06). Termos prometiam reembolso de 7 dias sobre cobrança inexistente — corrigido pra refletir que não há cobrança dentro do app. Escopo declarado: portal/leads/Dualhook são back-office, política do app fala só do app (ressalva do usuário registrada).

## PRO — bug do selo mentiroso (Auditoria 2, A1)
Duas fontes de verdade divergentes: `TopNav` usava `is_pro=true` sozinho, `canSeeProFeature` exigia também data futura. Nada limpa `is_pro` no vencimento (permanece PRO visualmente pra sempre). **Regra: selo e portão perguntam à mesma função.**

---
## Ver também
[[Orçamentos (Quotes) - Wizard, PDF e Tabela ABRAPP]] · [[Segurança - Auditorias Externas (Webhooks e Integrações)]]
