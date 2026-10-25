// purchases.ts — compras nas lojas (Google Play / App Store) pela RevenueCat.
//
// Plugin nativo `Purchases` (@revenuecat/purchases-capacitor, instalado na
// RAIZ do repo, entra no AAB/IPA). Igual aos outros wrappers: acessado só
// por `window.Capacitor`, nunca importado no bundle web. Fora da casca, ou
// numa casca antiga sem o plugin, `isPurchasesAvailable()` é false e a tela
// diz que a compra é só pelo app.
//
// Preço SEMPRE vem da loja (`priceString` do produto) — nada de preço no
// código. E nada daqui credita saldo: depois de comprar, o app chama
// `/api/billing/sync` e o SERVIDOR confere na RevenueCat.

import { getNativePlatform, getPlugin, isNativePlatform } from './platform';

export interface StoreProduct {
  identifier: string;
  title: string;
  description: string;
  price: number;
  priceString: string;
}

interface PurchasesPlugin {
  configure: (o: { apiKey: string; appUserID?: string | null }) => Promise<void>;
  logIn: (o: { appUserID: string }) => Promise<unknown>;
  logOut: () => Promise<unknown>;
  getAppUserID?: () => Promise<{ appUserID: string }>;
  getProducts: (o: { productIdentifiers: string[]; type?: string }) => Promise<{ products: StoreProduct[] }>;
  purchaseStoreProduct: (o: { product: StoreProduct }) => Promise<unknown>;
  restorePurchases: () => Promise<unknown>;
}

const TIMEOUT_MS = 20_000;
// Comprar abre a folha da loja e espera a pessoa: teto bem largo.
const PURCHASE_TIMEOUT_MS = 5 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: tempo esgotado`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function plugin(): PurchasesPlugin | undefined {
  if (!isNativePlatform()) return undefined;
  return getPlugin<PurchasesPlugin>('Purchases');
}

/** Chave PÚBLICA da RevenueCat por loja (vai no build; não é segredo). */
function publicKey(): string | undefined {
  const p = getNativePlatform();
  const k =
    p === 'android'
      ? process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY
      : p === 'ios'
        ? process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY
        : undefined;
  return k && k.trim() ? k.trim() : undefined;
}

export function isPurchasesAvailable(): boolean {
  return !!plugin() && !!publicKey();
}

let configuradoPara: string | null = null;

/** Configura (1ª vez) ou troca de conta. appUserID = id do usuário no Supabase. */
export async function configurePurchases(userId: string): Promise<boolean> {
  const p = plugin();
  const key = publicKey();
  if (!p || !key || !userId) return false;
  if (configuradoPara === userId) return true;
  if (configuradoPara === null) {
    await withTimeout(p.configure({ apiKey: key, appUserID: userId }), TIMEOUT_MS, 'configurar compras');
  } else {
    await withTimeout(p.logIn({ appUserID: userId }), TIMEOUT_MS, 'trocar conta nas compras');
  }
  configuradoPara = userId;
  return true;
}

/** No logout: desamarra a conta (a próxima compra não cai na anterior). */
export async function logOutPurchases(): Promise<void> {
  const p = plugin();
  if (!p || configuradoPara === null) return;
  try {
    await withTimeout(p.logOut(), TIMEOUT_MS, 'sair das compras');
  } catch {
    /* logOut de usuário já anônimo rejeita — sem problema */
  }
  configuradoPara = null;
}

/** Produtos com o preço da loja. Consumíveis e assinatura vêm em chamadas separadas no Android. */
export async function getStoreProducts(ids: { consumiveis: string[]; assinaturas: string[] }): Promise<StoreProduct[]> {
  const p = plugin();
  if (!p) return [];
  const [a, b] = await Promise.all([
    ids.consumiveis.length
      ? withTimeout(p.getProducts({ productIdentifiers: ids.consumiveis, type: 'NON_SUBSCRIPTION' }), TIMEOUT_MS, 'carregar produtos')
      : Promise.resolve({ products: [] as StoreProduct[] }),
    ids.assinaturas.length
      ? withTimeout(p.getProducts({ productIdentifiers: ids.assinaturas, type: 'SUBSCRIPTION' }), TIMEOUT_MS, 'carregar assinatura')
      : Promise.resolve({ products: [] as StoreProduct[] }),
  ]);
  return [...(a?.products || []), ...(b?.products || [])];
}

export type PurchaseOutcome = 'purchased' | 'cancelled';

/** Abre a folha da loja. 'cancelled' quando a pessoa desistiu. */
export async function purchaseProduct(product: StoreProduct): Promise<PurchaseOutcome> {
  const p = plugin();
  if (!p) throw new Error('Compras indisponíveis nesta versão do app.');
  try {
    await withTimeout(p.purchaseStoreProduct({ product }), PURCHASE_TIMEOUT_MS, 'compra');
    return 'purchased';
  } catch (e) {
    if (ehCancelamento(e)) return 'cancelled';
    throw e;
  }
}

export async function restoreStorePurchases(): Promise<void> {
  const p = plugin();
  if (!p) throw new Error('Compras indisponíveis nesta versão do app.');
  await withTimeout(p.restorePurchases(), TIMEOUT_MS * 2, 'restaurar compras');
}

/** Erro da RevenueCat de "o usuário cancelou" (código 1 / userCancelled). */
export function ehCancelamento(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as { code?: unknown; userCancelled?: unknown; data?: { userCancelled?: unknown }; message?: unknown };
  if (o.userCancelled === true || o.data?.userCancelled === true) return true;
  if (String(o.code) === '1') return true;
  return /cancel/i.test(String(o.message || ''));
}
