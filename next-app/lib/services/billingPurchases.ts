// billingPurchases — orquestra a compra no app (abstração única de billing).
//
// Fluxo: tela pede → plugin da loja (RevenueCat) compra → app chama
// `/api/billing/sync` → SERVIDOR confere na RevenueCat e credita → app relê
// o saldo do banco (`my_billing_balance`). O app nunca decide crédito.

import { getSupabase } from '../supabase';
import { fetchGated } from './fetchGated';
import { BILLING_PRODUCTS, saldoDaLinha, type BillingBalance } from '../billingBalance';
import { reportFailure } from '../utils/reportFailure';
import { getNativePlatform } from '../native/platform';
import {
  configurePurchases,
  descreverErroDaLoja,
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

export interface CargaDeProdutos {
  lista: ProdutoDaLoja[];
  /** Por que veio menos que o pedido (erro real da loja ou ids faltando). null = veio tudo. */
  problema: string | null;
}

// `obra_1` saiu da tela com o crédito único (2026-10-28): não é pedido à
// loja, senão a falta dele (produto desativado) apareceria como problema.
const IDS_CONSUMIVEIS = [BILLING_PRODUCTS.quote1, BILLING_PRODUCTS.quotePack40];
const IDS_ASSINATURAS = [BILLING_PRODUCTS.pro];

/**
 * Produtos com o preço vindo da loja. Nunca lança: o que deu errado volta
 * em `problema` (mostrado na folha) e vai pro /admin/errors — antes, erro,
 * timeout e "loja devolveu zero" viravam a MESMA frase genérica e não dava
 * pra saber qual dos três era.
 */
export async function carregarProdutos(userId: string): Promise<CargaDeProdutos> {
  let problema: string | null = null;
  let lista: ProdutoDaLoja[] = [];
  try {
    if (!(await configurePurchases(userId))) {
      problema = 'compras não configuradas (plugin ou chave pública ausente)';
    } else {
      const r = await getStoreProducts({ consumiveis: IDS_CONSUMIVEIS, assinaturas: IDS_ASSINATURAS });
      lista = r.products.map((p) => ({
        // No Google a assinatura volta como "quotes_unlimited:<plano base>".
        id: p.identifier.split(':')[0],
        preco: p.priceString,
        produto: p,
      }));
      const vieram = new Set(lista.map((p) => p.id));
      const faltando = [...IDS_CONSUMIVEIS, ...IDS_ASSINATURAS].filter((id) => !vieram.has(id));
      const partes = [...r.falhas];
      if (faltando.length) partes.push(`a loja não devolveu: ${faltando.join(', ')}`);
      problema = partes.length ? partes.join(' | ') : null;
    }
  } catch (e) {
    problema = `configurar compras: ${descreverErroDaLoja(e)}`;
  }
  if (problema) {
    reportFailure('billing-products-fail', new Error(problema), {
      userId,
      ctx: `plataforma=${getNativePlatform()} recebidos=${lista.map((p) => p.id).join(',') || 'nenhum'}`,
    });
  }
  return { lista, problema };
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
