# Compras no app — configuração (QueroUmaCor)

Guia do que **você** precisa fazer fora do código para as compras
funcionarem. O código já está pronto e **não cobra nem bloqueia ninguém**
enquanto a chave `billing_config.enforce` estiver desligada (ela nasce
desligada).

## 1. O que está à venda

| ID do produto (igual nas duas lojas) | Tipo na loja | O que dá | Preço que você definiu |
|---|---|---|---|
| `quote_1` | Consumível (Google: *produto no app* / Apple: *Consumable*) | +1 orçamento | R$ 1,00 |
| `quote_pack_40` | Consumível | +40 orçamentos | R$ 29,90 |
| `obra_1` | Consumível | +1 obra na Gestão de Obras | R$ 2,90 |
| `quotes_unlimited` | Assinatura mensal (Google: *assinatura* com plano base mensal / Apple: *Auto-Renewable Subscription*, 1 mês) | PRO completo: orçamentos e obras ilimitados + ferramentas com IA | R$ 59,90/mês |

- **O preço vale o que estiver na loja.** O app mostra o preço que a loja
  devolve; não há preço no código.
- Use **exatamente** esses IDs. No Google, o plano base da assinatura pode ter
  qualquer nome (ex.: `mensal`); o app reconhece `quotes_unlimited:<plano>`.
- Na Apple, coloque a assinatura num *Subscription Group* (ex.: "PRO").
- Grátis para todo mundo (já existe no banco): **5 orçamentos** e **1 obra**.
  Ferramentas com IA: **1 uso grátis de cada**; Seu Zé, Fê e Senna: **3
  mensagens grátis no total**. A Alice (cliente) segue com **3 perguntas por
  dia**, como já era.

## 2. RevenueCat (o "meio de campo" que confere as compras)

1. Crie a conta em https://app.revenuecat.com (grátis até ~US$ 2.500/mês de receita).
2. Crie um **Project** "QueroUmaCor" e adicione dois apps:
   - **Google Play**: package `br.com.queroumacor`. Ele pede o JSON de uma
     *service account* com acesso à Play Console (pode ser uma nova, só com
     permissão de ver vendas/assinaturas). Siga o passo a passo da tela.
   - **App Store**: bundle `br.com.queroumacor.app`. Ele pede a *In-App
     Purchase Key* (App Store Connect → Users and Access → Integrations →
     In-App Purchase) e o *App-Specific Shared Secret*.
3. Em **Products**, importe/cadastre os 4 IDs da tabela acima nas duas lojas.
   (Opcional: crie um *Entitlement* "pro" ligado ao `quotes_unlimited` — o
   código não depende dele.)
4. **Project Settings → General → "Transfer behavior"**: escolha
   **"Keep with original App User ID"**. Assim um "Restaurar compras" numa
   conta diferente **não** move a compra de quem pagou (antifraude).
5. **API keys**: copie as duas chaves **públicas** (`goog_…` e `appl_…`) e
   gere uma chave **secreta v1** (`sk_…`).
6. **Integrations → Webhooks**: URL
   `https://queroumacor.com.br/api/billing/webhook` e, em *Authorization
   header*, um valor que você inventa (ex.: `Bearer ` + 40 caracteres
   aleatórios — gere com `openssl rand -hex 20`).

## 3. Variáveis que você precisa gerar e cadastrar

Nenhuma delas está no código. **Segredo nunca vai pro repositório.**

| Variável | Onde cadastrar | Tipo | De onde vem |
|---|---|---|---|
| `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` | GitHub → Settings → Secrets → Actions | pública (vai no build) | RevenueCat, chave `goog_…` |
| `NEXT_PUBLIC_REVENUECAT_IOS_KEY` | GitHub → Secrets → Actions | pública (vai no build) | RevenueCat, chave `appl_…` |
| `REVENUECAT_SECRET_KEY` | Cloudflare → Worker `queroumacor-next-production` → Settings → Variables (**Secret**) | segredo | RevenueCat, chave `sk_…` |
| `REVENUECAT_WEBHOOK_AUTH` | Cloudflare → Worker → Variables (**Secret**) | segredo | o mesmo valor do *Authorization header* do passo 2.6 (com o `Bearer `) |

Depois de cadastrar as duas públicas, rode o `deploy.yml` de novo (elas
entram no build do site).

## 4. Cloudflare — liberar o webhook no WAF

A regra de bots da zona bloqueia IP de datacenter (foi o que barrou o smoke
test do GitHub). A RevenueCat chama de datacenter. Crie uma regra de
**Skip** igual à que já existe pro webhook do WhatsApp, para o caminho
`/api/billing/webhook`. Sem isso o webhook leva 403 — as compras continuam
sendo creditadas pela confirmação feita logo após a compra no app, mas
renovação, cancelamento e reembolso só chegariam quando a pessoa abrisse a
tela de planos.

## 5. SQL (Supabase → SQL Editor), nesta ordem

1. `migrations/2026-10-25-fix-protect-triggers-invoker.sql` — **correção de
   segurança, rodar já** (independe das compras; ver "Riscos").
2. `migrations/2026-10-25-billing-balance.sql` — saldo, débito, crédito.
3. `migrations/2026-10-25-billing-pro-and-ai-trial.sql` — teste grátis das IAs.

Cada um termina com uma conferência (todas as linhas `ok = true`).

## 6. Builds

- **Android (Codemagic, `android-aab`)**: o plugin
  `@revenuecat/purchases-capacitor` já está no `package.json` da raiz; o
  `npx cap sync` da build inclui. A permissão de cobrança do Google entra
  sozinha pelo plugin. Suba pro *Internal testing* e cadastre seu e-mail
  como **testador de licença** (Play Console → Setup → License testing) —
  aí as compras são de teste e não cobram.
- **iOS (Codemagic, `ios-ipa`)**: idem. No TestFlight as compras são de
  *sandbox* (não cobram). Os produtos precisam estar "Ready to Submit" e a
  primeira versão com compras vai junto pra revisão, com os produtos
  anexados à versão.
- **Fora do app** (navegador/PWA) não existe compra: a tela de planos
  mostra o saldo e avisa que a compra é pelo app.

## 7. Ligar a cobrança

Só **depois** que o AAB e o IPA com a tela de compra estiverem aprovados e
publicados (senão quem está na versão antiga fica sem saldo e sem como
comprar):

```sql
UPDATE public.billing_config SET enforce = true WHERE id = 1;
```

Para desligar de novo: `SET enforce = false`. Com a cobrança desligada,
ninguém é barrado nem debitado; a tela do orçamento continua só para PRO
(como hoje) e abre para todo mundo no momento em que você ligar.

## 8. Como testar

1. Conta nova: grave 5 orçamentos; o 6º abre a tela de compra.
2. Compre `quote_1` (testador de licença): o saldo vira "1 comprado".
3. Compre a assinatura: aparece "Você é PRO", o selo PRO acende e as
   ferramentas PRO abrem.
4. Desinstale, instale, entre na mesma conta → **Restaurar compras**.
5. Entre com **outra** conta no mesmo aparelho e restaure: a compra **não**
   deve ir pra ela.
6. Reembolse um consumível pela Play Console: o crédito some (via webhook).

## 9. Riscos e limites conhecidos

- **Correção de segurança achada no caminho:** a trava que impede o usuário
  de se dar PRO (`protect_profile_columns`) não travava nada — era
  `SECURITY DEFINER` e decidia pelo `current_user`, que ali é sempre o dono
  da função. Qualquer usuário podia virar PRO pela API. O arquivo de
  correção resolve; **rode antes do resto**. Vale conferir quem tem PRO
  hoje sem você ter dado (ver consulta no chat).
- Compras de **teste** (testadores do Google, TestFlight) também creditam:
  a Apple exige que a revisão consiga comprar em sandbox. O risco é limitado
  a quem você convida pros testes.
- Crédito **já gasto** não volta num reembolso (o saldo nunca fica
  negativo).
- Se a confirmação logo após a compra falhar (rede), a compra não se perde:
  o webhook credita depois, ou a pessoa toca "Restaurar compras".
- A RevenueCat é um terceiro: se ela sair do ar, compras novas esperam a
  confirmação; nada já creditado se perde.
- Cancelamento da assinatura mantém o PRO até o fim do período pago;
  carência de cobrança (cartão recusado) mantém o PRO enquanto a loja
  estiver tentando.
- O PRO dado à mão pelo portal **sem data** nunca é mexido pela assinatura;
  com data, a assinatura só estende (nunca encurta).
