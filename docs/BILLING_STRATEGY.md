# BILLING_STRATEGY.md

**Última atualização:** 2026-06-11
**Owner:** Cali Colors / QueroUmaCor
**Escopo:** Estratégia de cobrança da assinatura PRO (R$ 39/mês) e da
loja física (tinta, camiseta etc.) considerando políticas da Apple App
Store, Google Play Store e Mercado Pago (web).

---

## 1. Resumo da decisão

| Runtime | Provider de subscription PRO | Provider da loja física |
|---|---|---|
| **Web** (browser direto em queroumacor.com.br) | **Mercado Pago** | Mercado Pago |
| **TWA Android** (Google Play Store) | **Google Play Billing** | Mercado Pago |
| **iOS App Store** (wrapper Capacitor) | **Apple StoreKit IAP** | Mercado Pago |

**Comissões aproximadas:**

- Mercado Pago: 4,99% + taxa fixa (variando por método de pagamento).
- Google Play Billing: 30% no 1º ano, 15% após o 1º ano para
  assinaturas (Play Media Experience Program). Brasil já segue essa
  tabela.
- Apple StoreKit IAP: 30% padrão, 15% no Small Business Program (revenue
  &lt; US$ 1M/ano da empresa). A Cali Colors qualifica como Small
  Business no início.

---

## 2. Por que essa separação

### Apple Guideline 3.1.1 — In-App Purchase

> "If you want to unlock features or functionality within your app, (by
> way of example: subscriptions, in-game currencies, game levels, access
> to premium content, or unlocking a full version), you must use in-app
> purchase."

A assinatura PRO desbloqueia digital content único do app (Seu Zé sem
limite, IA gen, CRM, análise financeira, badge verificado). Sem dúvida
cai na regra. **Tentar processar via Mercado Pago no iOS = rejeição
certa no review.**

Exceções permitidas pra payment processor externo (não se aplicam ao
PRO):

- Bens físicos enviados pra cliente (✅ a loja Cali Colors entra aqui).
- "Reader apps" (Spotify, Kindle) com conteúdo consumido em outras
  plataformas — exige programa "External Link Account" da Apple,
  com declaração formal.
- Conteúdo profissional B2B (CRM, ERP) — gray area.

### Google Play 2024 Payments Policy

> "Developers offering products within a game downloaded on Google
> Play or providing access to game content must use Google Play's
> billing system as the method of payment."

E mais amplo:

> "Subscription-based services and in-app features must use Google
> Play Billing."

Mesma situação do Apple. Loja física segue OK via MP.

### Web (PWA via browser)

Sem app store envolvida — pode usar qualquer payment processor. Mercado
Pago é nossa escolha (já integrado, baixa taxa, brasileiro).

### Loja física (Cali Colors tinta/camiseta)

Nunca precisa de IAP/Play Billing — bens físicos são explicitamente
permitidos via payment processor externo em ambas as lojas. Segue 100%
no Mercado Pago.

**Cuidado UX:** evitar misturar PRO subscription e compra de produto
físico na mesma jornada — Apple/Google pode interpretar como tentativa
de evasão. Manter telas separadas (`/pro` ≠ `/loja`).

---

## 3. Setup operacional

### 3.1 Apple App Store Connect

1. **Criar Product ID**
   - ID: `com.calicolors.queroumacor.pro.monthly`
   - Tipo: Auto-Renewable Subscription
   - Subscription Group: `PRO` (criar grupo único)
2. **Preço**: BRL 39 (Tier mapeado pela Apple — ajustar pra Tier mais
   próximo se exato não existir)
3. **Duration**: 1 mês
4. **Free trial** (opcional, melhora conversão): 7 dias
5. **Promotional offer** (opcional): 50% off primeiro mês
6. **Localized info**:
   - pt-BR: "Plano PRO — Pedidos ilimitados, IA, Cursos"
   - en-US (review): "PRO Plan — Unlimited quotes, AI, Courses"
7. **App-Specific Shared Secret**: gerar em App Store Connect →
   Subscriptions → App-Specific Shared Secret. Guardar em
   `APPLE_APP_SHARED_SECRET` env var (Cloudflare Pages).

### 3.2 Google Play Console

1. **Apps > Monetize > Subscriptions > Add subscription**
   - Product ID: `com.calicolors.queroumacor.pro.monthly`
   - Base plan: Monthly, BRL 39
2. **Free trial** (opcional): 7 dias
3. **Grace period**: 7 dias (alinhar com `profiles.pro_grace_until` Wave 7
   que usa 3 dias — Play permite 3, 7, 14 ou 30 dias. Usar 7 dias).
4. **Service account pra Developer API**:
   - Google Cloud Console → IAM → Service Accounts → criar conta
   - Conceder role `Service Account User` + permissão
     `androidpublisher.subscriptions.get`
   - Gerar JSON key, guardar em `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` env
     var (Cloudflare Pages)
5. **Real-Time Developer Notifications** (RTDN, opcional mas
   recomendado): configurar Pub/Sub topic, Google envia notificação
   em qualquer mudança de subscription (renew, cancel, grace,
   refund). Sem RTDN, precisa polling pra detectar cancelamento.

### 3.3 Mercado Pago (web fallback)

- Manter `preapproval` existente (criado por `/api/checkout`)
- Webhook em `/api/mp-webhook` segue valendo
- Sem ações novas — fluxo atual continua

---

## 4. Server-side verification (CRÍTICO em produção)

### ⚠️ Estado atual: STUB INSEGURO

Os endpoints `/api/apple-iap-verify` e `/api/play-billing-verify` aceitam
qualquer `receipt`/`purchaseToken` às cegas e gravam invoice como paga.
**Em produção, qualquer cliente pode forjar um token e virar PRO.**

Antes de submeter pras lojas, IMPLEMENTAR validação real conforme abaixo.

### 4.1 Apple verifyReceipt

**Endpoint:**

- Production: `https://buy.itunes.apple.com/verifyReceipt`
- Sandbox: `https://sandbox.itunes.apple.com/verifyReceipt`

**Request:**

```http
POST /verifyReceipt
Content-Type: application/json

{
  "receipt-data": "<base64-encoded receipt>",
  "password": "<APPLE_APP_SHARED_SECRET>",
  "exclude-old-transactions": true
}
```

**Resposta válida** (`status === 0`):

```json
{
  "status": 0,
  "latest_receipt_info": [
    {
      "product_id": "com.calicolors.queroumacor.pro.monthly",
      "transaction_id": "...",
      "expires_date_ms": "1764550000000",
      ...
    }
  ]
}
```

**Lógica:**

1. Tentar production primeiro.
2. Se `status === 21007` (sandbox receipt), retry no sandbox.
3. Validar `product_id` casa.
4. Validar `expires_date_ms` é futuro.
5. Só então gravar invoice como paga.

### 4.2 Google Play Developer API

**Setup:**

```bash
npm i googleapis
```

**Chamada:**

```typescript
import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON!),
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

const publisher = google.androidpublisher({ version: 'v3', auth });

const { data } = await publisher.purchases.subscriptionsv2.get({
  packageName: 'br.com.queroumacor.app',
  token: purchaseToken,
});

// Validar:
if (data.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE') {
  throw new Error('Subscription not active');
}
const lineItem = data.lineItems?.[0];
if (lineItem?.productId !== 'com.calicolors.queroumacor.pro.monthly') {
  throw new Error('Wrong product');
}
```

**RTDN (Real-Time Developer Notifications):** configurar Pub/Sub
subscription que dispara webhook na mudança de status. Sem isso, app
não detecta cancelamento até próximo polling.

### 4.3 Sem verificação server-side, qualquer cliente pode mandar token forjado e virar PRO

**Stubs implementados** (`/api/apple-iap-verify`, `/api/play-billing-verify`)
aceitam o token às cegas — TODO antes de production. Já existe
console.warn em cada um lembrando.

---

## 5. ENV vars necessárias (Cloudflare Pages)

| Variável | Origem | Uso |
|---|---|---|
| `APPLE_APP_SHARED_SECRET` | App Store Connect → Subscriptions → App-Specific Shared Secret | verifyReceipt body |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Cloud Console (JSON da service account) | googleapis auth |
| `MP_ACCESS_TOKEN` (já existe) | Mercado Pago | preapproval |
| `MP_WEBHOOK_SECRET` (já existe) | Mercado Pago | webhook signature |
| `SUPABASE_SERVICE_ROLE_KEY` (já existe) | Supabase | upsert_invoice via RLS bypass |

---

## 6. Fluxo de dados

```
┌──────────┐         ┌────────────────┐
│  Cliente │         │ Loja (Apple/   │
│  app/web │         │ Google/MP)     │
└────┬─────┘         └──────┬─────────┘
     │ 1. clica Assinar     │
     │──────────────────────│
     │ 2. fluxo de payment  │
     │◄─────────────────────│
     │                      │
     │ 3. receipt/token     │
     │──┐                   │
     │  │ 4. POST           │
     │  ▼ /api/<provider>-verify
┌─────────────────┐
│ Edge route      │ 5. verifica receipt/token com loja
│ (Cloudflare)    │ 6. upsert_invoice(...)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Supabase        │ trigger handle_invoice_paid →
│ tabela invoices │ profiles.is_pro = true,
│                 │ pro_expires_at = now + 30d
└─────────────────┘
```

---

## 7. Posição jurídica

A Cali Colors deve consultar advogado sobre:

1. Se "PRO subscription" pode ser argumentada como "acesso ao serviço
   cloud" em vez de "digital content único do app". Cinza pro Google
   Play — a regra abre exceção pra "cloud services" mas não pra "in-app
   features unlock", e o limite é a interpretação do reviewer.
2. Apple é black-and-white: digital subscription = IAP. Sem brecha.
3. Loja física sempre OK via MP — mas **não pode misturar UX**: usuário
   não pode "comprar PRO" e na mesma jornada "comprar tinta" via MP,
   parece tentativa de evasão.

---

## 8. Roadmap

### Now (entregue 2026-06-11)

- ✅ Abstração `lib/services/billing-platform.ts` (detecta plataforma,
  roteia provider).
- ✅ `/pro` chama `startProCheckout(userId)` em vez de WhatsApp manual.
- ✅ Endpoint stub `/api/apple-iap-verify`.
- ✅ Endpoint stub `/api/play-billing-verify`.
- ✅ Documentação (este arquivo).
- ✅ Tests da detecção de plataforma.

### Pré-launch lojas

- ⏳ Implementar Apple `verifyReceipt` real em `/api/apple-iap-verify`.
- ⏳ Implementar Google `subscriptionsv2.get` real em
  `/api/play-billing-verify`.
- ⏳ Configurar `APPLE_APP_SHARED_SECRET` +
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` no Cloudflare Pages.
- ⏳ Criar product IDs em App Store Connect + Play Console.
- ⏳ Instalar `capacitor-plugin-purchase` no wrapper iOS.
- ⏳ Configurar Bubblewrap pra TWA Android com Digital Goods enabled.

### Pós-launch

- ⏳ Webhook Apple App Store Server Notifications V2 (renewal /
  cancel / grace).
- ⏳ Pub/Sub subscription pra Google RTDN.
- ⏳ Dashboard admin `/admin/billing` mostrando invoices por provider.
- ⏳ Reconciliação automática mensal (verifica que cada `is_pro=true`
  tem invoice paga correspondente).

---

## 9. Checklist pra reviewer (Apple/Google)

Quando submeter pra review da loja, garantir:

- [ ] Botão "Assinar" mostra preço local (R$ 39) — não em USD.
- [ ] Tela /pro tem link pros termos e privacidade (já existe ✓).
- [ ] Restore Purchases botão (iOS exige — Capacitor IAP plugin tem
      `restorePurchases()` separado).
- [ ] Account Deletion in-app funciona (Wave 27 + `/api/delete-account`
      ✓).
- [ ] Privacy Manifest .xcprivacy declarando uso de Sentry, etc.
      (Apple — pendente, ver `RELEASE_AUDIT.md` C7).
- [ ] Data Safety form preenchido (Google Play — pendente, ver
      `RELEASE_AUDIT.md` C3).

---

## 10. Referências

- Apple Guideline 3.1.1 — In-App Purchase: https://developer.apple.com/app-store/review/guidelines/#in-app-purchase
- Apple verifyReceipt API: https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
- Google Play Payments Policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Google Play Developer API: https://developers.google.com/android-publisher
- Digital Goods API (Chromium): https://chromestatus.com/feature/5339955590955008
- Capacitor StoreKit plugin: https://github.com/capacitor-community/in-app-purchases
- W3C Payment Request API: https://www.w3.org/TR/payment-request/
