// billingPurchases — orquestra a compra no app (abstração única de billing).
//
// Fluxo: tela pede → plugin da loja (RevenueCat) compra → app chama
// `/api/billing/sync` → SERVIDOR confere na RevenueCat e credita → app relê
// o saldo do banco (`my_billing_balance`). O app nunca decide crédito.

import { getSupabase } from '../supabase';
import { fetchGated } from './fetchGated';
import { BILLING_PRODUCTS, saldoDaLinha, type BillingBalance } from '../billingBalance';
import {
  configurePurchases,
  getStoreProducts,
  isPurchasesAvailable,
  purchaseProduct,
  restoreStorePurchases,
  type StoreProduct,
} from '../native/purchases';

export { isPurchasesAvailable };
export type { StoreProduct };

/** Saldo do usuário logado. null = SQL ainda não rodado (função ausente). */
export async function fetchBillingBalance(): Promise<BillingBalance | null> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('my_billing_balance' as never);
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '42883' || code === 'PGRST202') return null;
    throw error;
  }
  return saldoDaLinha(data);
}

export interface ProdutoDaLoja {
  id: string;
  /** Preço formatado pela loja (moeda e imposto do país da pessoa). */
  preco: string;
  produto: StoreProduct;
}

/** Produtos com o preço vindo da loja. Lista vazia = loja não respondeu. */
export async function carregarProdutos(userId: string): Promise<ProdutoDaLoja[]> {
  if (!(await configurePurchases(userId))) return [];
  const produtos = await getStoreProducts({
    consumiveis: [BILLING_PRODUCTS.quote1, BILLING_PRODUCTS.quotePack40, BILLING_PRODUCTS.obra1],
    assinaturas: [BILLING_PRODUCTS.pro],
  });
  return produtos.map((p) => ({
    // No Google a assinatura volta como "quotes_unlimited:<plano base>".
    id: p.identifier.split(':')[0],
    preco: p.priceString,
    produto: p,
  }));
}

/** Pede ao servidor pra conferir na RevenueCat e creditar. */
export async function sincronizarNoServidor(): Promise<void> {
  const res = await fetchGated('/api/billing/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || `Falha ao confirmar a compra (${res.status}).`);
  }
}

export type ResultadoCompra = 'ok' | 'cancelado';

export async function comprar(userId: string, p: ProdutoDaLoja): Promise<ResultadoCompra> {
  if (!(await configurePurchases(userId))) throw new Error('Compras indisponíveis nesta versão do app.');
  const r = await purchaseProduct(p.produto);
  if (r === 'cancelled') return 'cancelado';
  await sincronizarNoServidor();
  return 'ok';
}

export async function restaurar(userId: string): Promise<void> {
  if (!(await configurePurchases(userId))) throw new Error('Compras indisponíveis nesta versão do app.');
  await restoreStorePurchases();
  await sincronizarNoServidor();
}

export { abrirPaywall, PAYWALL_EVENT, type MotivoPaywall } from '../paywallEvents';
