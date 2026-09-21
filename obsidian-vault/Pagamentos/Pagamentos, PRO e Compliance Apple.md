---
tags: [pagamentos, pro, mercado-pago, apple, compliance]
---

# Pagamentos, PRO e Compliance Apple

## Compliance Apple 3.1.3(e) — loja sem pagamento no app (2026-06-18)
A loja Cali Colors NÃO processa pagamento dentro do app: o cliente só monta a "Lista de Pedido" e a loja fecha a venda fora do app (WhatsApp).

- **Removido o fluxo Mercado Pago da LOJA** (produtos físicos): deletados `next-app/app/api/mp-checkout-loja/route.ts`, `next-app/lib/api/_services/mp-checkout-loja.ts` e o teste correspondente. `CartView` agora só chama `useCart.checkout()` → `submitOrder` (grava order `status='pending'` no Supabase), esvazia a lista e mostra "Pedido enviado! A equipe da Cali Colors entrará em contato via WhatsApp em breve.". Sem redirect pra URL externa de pagamento. Botões/títulos renomeados: "Selecionar" / "+ Selecionar item" / "Minha Lista de Pedido" / "Enviar Lista". Não havia rota de retorno (`?compra=` apontava pra `/`).
- **PRO mantido, MAS sem checkout no app (por enquanto).** `ProView` (`next-app/app/pro/ProView.tsx`) não chama mais `startProCheckout` — mostra nota "Para ativar o plano PRO, entre em contato com a loja física Cali Colors pelo telefone (11) 95976-5031" + botão WhatsApp. Ativação é MANUAL (a loja seta `profiles.is_pro` no perfil, hoje pelo `/portal` — ver [[Portal - Pessoas, Produtos e Ferramentas]] pro modal de período do PRO). O `billing-platform.ts` + `/api/checkout` + `/api/mp-webhook` continuam no repo intactos (não deletados) pra retomar depois se decidirem.
- `MP_ACCESS_TOKEN` ainda é usado por `/api/checkout` (PRO web) e `/api/mp-webhook` — **NÃO remover a env**.

## Documentos legais atualizados (2026-09-06, PR #240)
A Privacidade listava o **Mercado Pago** como operador que recebe dados pra "processamento de pagamentos do plano PRO e da loja", e os Termos do Cliente prometiam **reembolso integral em 7 dias do Plano PRO**. Os dois descreviam o mundo anterior a 18/06: desde então o PRO é ativado por **troca de pontos**/ação manual da loja (item 13 dos Termos gerais) e o carrinho da loja só registra o pedido — a venda fecha com a Cali Colors fora do app (compliance Apple 3.1.3(e)). `startProCheckout` existe em `lib/services/billing-platform.ts` mas **não tem call site de UI nenhum**, então nenhum dado sai do app pro MP.

- **Operador que não recebe nada sai da lista de compartilhamento** — deixar ali sugere um fluxo de dados que não existe. No lugar entrou a frase que diz o fato ("não há pagamento dentro do aplicativo").
- **Direito prometido sobre cobrança inexistente também é erro**: o reembolso virou a regra real (sem cobrança → sem fatura nem reembolso), preservando o prazo do CDC pras compras feitas com a loja FORA do app.
- **A data de "última atualização" da Privacidade estava em 22/05** — antes de metade do que o histórico do projeto registra. Documento legal com data velha é do mesmo tipo da lista de pendências: envelhece e ninguém revalida.
- **Escopo declarado pelo usuário:** portal, mídia do WhatsApp, os leads e o Dualhook são **back-office**, não aparecem pra quem usa o app — a política do app fala do app. A ressalva registrada: a LGPD prende no TITULAR, não na tela; os leads e quem tem áudio transcrito por terceiro nos EUA são titulares da Cali Colors de todo jeito. Se um dia quiserem cobrir isso, é uma seção de prospecção/portal separada, não uma linha na política do app.

## Billing platform (C1 do RELEASE_AUDIT, 2026-06-11)
`next-app/lib/services/billing-platform.ts` detecta web/iOS-wrapper/Android-wrapper e roteia checkout pra MP/StoreKit/Play Billing. `/api/play-billing-verify` e `/api/apple-iap-verify` **fail-closed em produção** sem `IAP_PRODUCTION_VERIFICATION_ENABLED=true` (CRIT-1 do audit de 2026-06-12 — eram STUBS que aceitavam token sem call ao server do Apple/Google) — **não setar essa env até implementar verificação real** (Google Play Developer API + Apple `verifyReceipt`). Doc: `docs/BILLING_STRATEGY.md`.

## Grace period e cota de IA — SQL Wave 7 (2026-05-31)
**JÁ EXECUTADO no Supabase.** Hardening pagamentos/subscription (itens #11, #17, #18, #19 do backlog de pagamentos):
1. tabela `invoices` (rastreio de cobrança/refund pra conciliação MP, RLS user-owned read; write só via service_role);
2. coluna `profiles.pro_grace_until` + função `is_pro_active(uuid)` que considera grace period de 3 dias (`canSeeProFeature` client + `gateAiUsage` server-side usam);
3. tabela `ai_usage` (audit de uso de IA por feature, RLS user-owned read; write só via service_role) + RPC `ai_usage_this_month(uuid, text?)`;
4. tabela `plan_limits` (free=30, pro=500, admin=99999 calls/mês, public read);
5. trigger `handle_invoice_paid` (transição `invoices.status → 'paid'` em `type=subscription` propaga `is_pro=true + pro_expires_at +30d` no profile);
6. RPC `upsert_invoice(...)` (idempotente por `external_id`, usado pelo mp-webhook).

Migration única em `/migrations/2026-05-31-payments-hardening.sql`. Service novo em `next-app/lib/services/billing.ts`; helpers REST edge-friendly em `next-app/lib/api/_services/_billing-helpers.ts`; security wrapper `gateAiUsage` + `recordAiUsage` em `next-app/lib/api/security.ts`. Todas as 14 rotas de IA (`chat-ai`, `caption`, `transcribe`, `tts`, `generate-logo`, `area-from-photo`, `pricing-suggest`, `fin-analysis`, `crm-draft`, `agenda-order`, `resolve-color`, `moderate`, `moderate-video`, `ig-art`) chamam `gateAiUsage` antes da IA e `recordAiUsage` depois do sucesso. `policies.ts canSeeProFeature` foi estendida pra considerar `pro_grace_until`. 21 testes em `__tests__/services/billing.test.ts` + 5 testes em `__tests__/policies.test.ts`.

## PRO — bug do selo mentiroso (Auditoria 2, achado A1, 2026-09-01)
**O selo PRO mentia pra quem venceu.** Havia DUAS fontes de verdade divergentes: o `TopNav` dizia PRO com `is_pro=true` sozinho, enquanto `canSeeProFeature` (o portão real, usado em Agenda/CRM/Anotações) exige `is_pro=true` **E** data futura quando há data. E **nada limpa `is_pro` no vencimento** — não há cron nem trigger, e o portal ativa PRO gravando `is_pro=true` + expiração. Ou seja, "is_pro com data vencida" é estado PERMANENTE: a pessoa via PRO na barra e levava "exclusivo do Plano PRO" em toda ferramenta. O `TopNav` agora usa `usePolicyUser` + `canSeeProFeature`/`isAdmin`. **REGRA: selo e portão perguntam à mesma função.** (Há uma 3ª implementação no banco, `is_pro_active`, usada pelo `gateAiUsage` server-side — as três precisam concordar.)

## Push Notifications (C8 do RELEASE_AUDIT) — relação com PRO/cota
Ver [[Segurança - Firebase FCM e Push]] pro detalhe completo do hardening de push. Registrado aqui só porque compartilha o mesmo `gateAiUsage`/`ai_usage` que o restante das rotas de IA gated por plano.

---
## Ver também
[[Orçamentos (Quotes) - Wizard, PDF e Tabela ABRAPP]] · [[Portal - Pessoas, Produtos e Ferramentas]] · [[Segurança - Auditorias Externas (Webhooks e Integrações)]] · [[Dados Oficiais - Cali Colors]] · [[Perfil - Edição, Avatar, Cadastro e Especialidades]]
