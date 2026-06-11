// billing-platform.ts — abstração de plataforma de cobrança da assinatura
// PRO. Detecta em qual runtime o app está rodando (browser web puro,
// wrapper iOS Capacitor, ou TWA Android) e roteia o checkout pro provider
// correto:
//
//   - Web (browser direto em queroumacor.com.br) → Mercado Pago (atual).
//   - iOS wrapper (Capacitor) → Apple StoreKit IAP (`com.calicolors.queroumacor.pro.monthly`).
//   - Android TWA → Google Play Billing via Digital Goods API.
//
// Por que essa separação? Apple Guideline 3.1.1 PROÍBE payment processor
// externo pra digital content (rejeita review se PRO for via MP). Google
// Play 2024 também pede Play Billing pra digital content único do app.
// Web (PWA) pode continuar com MP livremente. Detalhes em
// `docs/BILLING_STRATEGY.md`.
//
// IMPORTANTE: este módulo SÓ inicia o fluxo de checkout (UI/redirect/
// purchase API). A validação server-side do receipt/purchaseToken acontece
// em `/api/apple-iap-verify` (stub) e `/api/play-billing-verify` (stub).
// SEM essa validação, qualquer cliente pode forjar um token e virar PRO —
// os endpoints atuais aceitam o token às cegas e são placeholders.

import { showToast } from '@/lib/toast';

// ─── Tipos ─────────────────────────────────────────────────────────────────

export type BillingPlatform = 'web' | 'ios-wrapper' | 'android-wrapper' | 'unknown';

export type BillingProvider = 'mercado-pago' | 'apple-iap' | 'google-play-billing';

// Product IDs configurados nas lojas (App Store Connect / Play Console).
// MANTENHA SINCRONIZADO com docs/BILLING_STRATEGY.md.
export const PRO_PRODUCT_ID = 'com.calicolors.queroumacor.pro.monthly';
export const PRO_AMOUNT_BRL = 39;

// ─── Detecção de plataforma ────────────────────────────────────────────────

interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: Record<string, unknown>;
  };
}

interface TwaGlobal {
  // Chrome em TWA expõe getDigitalGoodsService no window.
  getDigitalGoodsService?: (paymentMethod: string) => Promise<unknown>;
}

/**
 * Detecta em qual plataforma o app está rodando.
 *
 * Heurísticas:
 *   - Capacitor seta `window.Capacitor.isNativePlatform()=true` quando em
 *     wrapper nativo. `getPlatform()` retorna 'ios' | 'android' | 'web'.
 *   - TWA do Android adiciona user-agent específico (`...wv) ... Chrome/...`)
 *     mas o jeito limpo é olhar se `getDigitalGoodsService` está exposta no
 *     window (só Chrome em TWA expõe).
 *   - SSR / sem window → 'unknown' (server-rendered, decide com base no header
 *     ou retorna fallback web).
 */
export function detectBillingPlatform(): BillingPlatform {
  if (typeof window === 'undefined') return 'unknown';

  // Capacitor wrapper — checa first porque sobrescreve plataforma mesmo
  // com user-agent web.
  const capWin = window as unknown as CapacitorGlobal;
  if (capWin.Capacitor?.isNativePlatform?.()) {
    const platform = capWin.Capacitor.getPlatform?.();
    if (platform === 'ios') return 'ios-wrapper';
    if (platform === 'android') return 'android-wrapper';
  }

  // TWA Android — Digital Goods API só existe no Chrome em TWA.
  const twaWin = window as unknown as TwaGlobal;
  if (typeof twaWin.getDigitalGoodsService === 'function') {
    return 'android-wrapper';
  }

  // Fallback: user-agent sniffing pra TWA com `wv` (legacy webview).
  // Não é confiável sozinho — `wv` aparece em qualquer webview embed.
  // Só usado como último recurso quando Digital Goods API não foi
  // detectada (browser mais antigo dentro de TWA).
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/\bwv\b/.test(ua) && /Android/.test(ua)) {
    return 'android-wrapper';
  }

  return 'web';
}

/**
 * Retorna qual processor usar pra subscription nesse runtime. Mapeamento
 * direto da plataforma → provider. SSR / unknown defaulta pra Mercado Pago
 * (caso mais comum em produção web).
 */
export function billingProvider(): BillingProvider {
  const platform = detectBillingPlatform();
  switch (platform) {
    case 'ios-wrapper':
      return 'apple-iap';
    case 'android-wrapper':
      return 'google-play-billing';
    case 'web':
    case 'unknown':
    default:
      return 'mercado-pago';
  }
}

// ─── Checkout entrypoint ───────────────────────────────────────────────────

/**
 * Inicia checkout PRO no processor adequado pra plataforma detectada.
 *
 * - Web → POST `/api/checkout` (Mercado Pago preapproval), redirect pro init_point.
 * - iOS wrapper → chama bridge JS<->Swift via `window.Capacitor.Plugins.InAppPurchase`.
 *   Como o plugin pode não estar instalado em dev/web preview, encapsulado
 *   em try/catch com fallback educado.
 * - Android wrapper → Digital Goods API + PaymentRequest. Resposta inclui
 *   purchaseToken que mandamos pra `/api/play-billing-verify`.
 *
 * Erros são exibidos via `showToast()` — chamador não precisa lidar com
 * UX de falha. Promise resolve quando checkout foi iniciado (não quando
 * pagamento completa — isso é assíncrono via webhook/receipt).
 */
export async function startProCheckout(userId: string): Promise<void> {
  if (!userId) {
    showToast('Faça login pra continuar', 'info');
    return;
  }

  const provider = billingProvider();
  try {
    switch (provider) {
      case 'mercado-pago':
        await startMercadoPagoCheckout();
        return;
      case 'apple-iap':
        await startAppleIapCheckout(userId);
        return;
      case 'google-play-billing':
        await startPlayBillingCheckout(userId);
        return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.warn('startProCheckout falhou:', msg);
    showToast('Falha ao iniciar pagamento — tente novamente', 'error');
  }
}

// ─── Mercado Pago (web) ────────────────────────────────────────────────────

async function startMercadoPagoCheckout(): Promise<void> {
  // Importa lazy pra não puxar @supabase em SSR de páginas que só renderizam
  // o tile sem clique.
  const { getSupabase } = await import('@/lib/supabase');
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  const accessToken = session?.access_token;

  if (!accessToken) {
    showToast('Sessão expirada — faça login novamente', 'info');
    return;
  }

  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const { init_point } = (await res.json()) as { init_point?: string };
  if (!init_point) throw new Error('init_point ausente na resposta');
  // Redirect pro checkout MP.
  window.location.href = init_point;
}

// ─── Apple StoreKit (iOS wrapper) ──────────────────────────────────────────

interface InAppPurchasePlugin {
  purchase: (opts: { productId: string }) => Promise<{
    receipt?: string;
    transactionId?: string;
    productId?: string;
  }>;
}

async function startAppleIapCheckout(userId: string): Promise<void> {
  const capWin = window as unknown as CapacitorGlobal;
  const plugin = capWin.Capacitor?.Plugins?.InAppPurchase as
    | InAppPurchasePlugin
    | undefined;

  if (!plugin || typeof plugin.purchase !== 'function') {
    // Em dev sem plugin: ajuda o developer entender o que falta.
    throw new Error(
      'InAppPurchase plugin não instalado. Instale capacitor-plugin-purchase ' +
        'e configure `com.calicolors.queroumacor.pro.monthly` em App Store Connect. ' +
        'Veja docs/BILLING_STRATEGY.md.'
    );
  }

  const result = await plugin.purchase({ productId: PRO_PRODUCT_ID });
  if (!result?.receipt || !result?.transactionId) {
    throw new Error('Apple IAP não retornou receipt/transactionId');
  }

  // Verifica receipt server-side. Endpoint stub aceita às cegas hoje;
  // em produção valida com Apple verifyReceipt (TODO em
  // docs/BILLING_STRATEGY.md).
  const res = await fetch('/api/apple-iap-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      receipt: result.receipt,
      transactionId: result.transactionId,
      productId: result.productId ?? PRO_PRODUCT_ID,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `verify HTTP ${res.status}`);
  }
  showToast('Assinatura PRO ativada!', 'success');
}

// ─── Google Play Billing (Android TWA) ─────────────────────────────────────

interface DigitalGoodsItemDetails {
  itemId: string;
  title?: string;
  description?: string;
  price: { currency: string; value: string };
}

interface DigitalGoodsService {
  getDetails: (skus: string[]) => Promise<DigitalGoodsItemDetails[]>;
}

interface PlayPaymentResponse {
  details: { token?: string };
  complete: (status: 'success' | 'fail' | 'unknown') => Promise<void>;
}

async function startPlayBillingCheckout(userId: string): Promise<void> {
  const twaWin = window as unknown as TwaGlobal;
  if (typeof twaWin.getDigitalGoodsService !== 'function') {
    throw new Error('Digital Goods API not available');
  }
  if (typeof PaymentRequest === 'undefined') {
    throw new Error('PaymentRequest API not available');
  }

  const dgs = (await twaWin.getDigitalGoodsService(
    'https://play.google.com/billing'
  )) as DigitalGoodsService;
  const items = await dgs.getDetails([PRO_PRODUCT_ID]);
  if (!items?.length) {
    throw new Error(
      `Produto ${PRO_PRODUCT_ID} não encontrado no Play Console — cadastre antes.`
    );
  }
  const item = items[0];

  // Lança fluxo PaymentRequest com Google Play instrument. O sistema operacional
  // mostra a sheet de confirmação do Play; aprovado → response.details.token.
  const req = new PaymentRequest(
    [{ supportedMethods: 'https://play.google.com/billing', data: { sku: PRO_PRODUCT_ID } }],
    {
      total: {
        label: 'QueroUmaCor PRO',
        amount: { currency: item.price.currency, value: item.price.value },
      },
    }
  );

  const response = (await req.show()) as unknown as PlayPaymentResponse;
  const purchaseToken = response.details?.token;
  if (!purchaseToken) {
    await response.complete('fail');
    throw new Error('Play Billing não retornou purchaseToken');
  }

  // Server-side: verifica purchaseToken em /api/play-billing-verify.
  // Stub aceita às cegas hoje; produção chamará Google Play Developer API
  // (TODO em docs/BILLING_STRATEGY.md).
  try {
    const res = await fetch('/api/play-billing-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, purchaseToken, productId: PRO_PRODUCT_ID }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `verify HTTP ${res.status}`);
    }
    await response.complete('success');
    showToast('Assinatura PRO ativada!', 'success');
  } catch (e) {
    await response.complete('fail');
    throw e;
  }
}
