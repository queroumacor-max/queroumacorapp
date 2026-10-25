// revenuecat.ts — confere as compras no SERVIDOR e credita no banco.
//
// Regra da casa (pedido do usuário): NUNCA creditar com base no que o app
// diz. O app só avisa "comprei"; quem decide é a RevenueCat, que valida a
// compra com o Google/Apple. Daqui a gente lê o estado VIVO do cliente na
// RevenueCat (`GET /v1/subscribers/{id}`, com a chave secreta) e aplica
// pelas RPCs do banco, que são idempotentes:
//   - consumível (quote_1, quote_pack_40, obra_1) → grant_billing_purchase,
//     chaveado pela transação da LOJA: credita UMA vez; a mesma transação
//     em outra conta volta 'conflict' e não credita;
//   - assinatura (quotes_unlimited) → set_pro_subscription com a data de
//     fim que a loja informa (renovação, cancelamento, carência, expiração
//     e reembolso viram só "até quando vale").
//
// O webhook da RevenueCat é só um GATILHO pra reler esse estado (mesmo
// padrão do webhook do Mercado Pago: nunca confiar no corpo). A única
// coisa que o webhook traz e a leitura não traz é o REEMBOLSO de
// consumível (a transação some da lista), por isso ele chama o revoke.
//
// Sobre "finalizar o consumível só depois do backend creditar": com a
// RevenueCat, a compra é registrada no servidor DELA antes de o SDK
// finalizar a transação na loja — a compra nunca se perde no meio. Nosso
// crédito sai dessa leitura (pós-compra no app E no webhook), os dois
// idempotentes; se a rota falhar, o webhook credita depois.

import { getRuntimeEnv } from '../env';
import { getServiceKey, getSupabaseUrl } from '../security';
import { BILLING_PRODUCTS, CREDITOS_POR_PRODUTO } from '../../billingBalance';

const RC_API = 'https://api.revenuecat.com/v1';
const TIMEOUT_MS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUsuarioValido(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Produto de assinatura? No Google vem como `quotes_unlimited:<plano base>`. */
export function ehProdutoAssinatura(productId: string): boolean {
  const p = String(productId || '');
  return p === BILLING_PRODUCTS.pro || p.startsWith(`${BILLING_PRODUCTS.pro}:`);
}

export function ehConsumivel(productId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CREDITOS_POR_PRODUTO, productId);
}

/** Chave da transação gravada em billing_events (loja + id da loja). */
export function chaveDaTransacao(store: unknown, storeTxId: unknown): string | null {
  const s = String(store || '').toLowerCase().trim();
  const t = String(storeTxId || '').trim();
  if (!s || !t) return null;
  return `rc:${s}:${t}`;
}

interface RcNonSubscription {
  id?: string;
  store_transaction_id?: string;
  store?: string;
  is_sandbox?: boolean;
  purchase_date?: string;
}
interface RcSubscription {
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
  refunded_at?: string | null;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  original_purchase_date?: string | null;
  store_transaction_id?: string | null;
  store?: string;
  is_sandbox?: boolean;
}
export interface RcSubscriber {
  non_subscriptions?: Record<string, RcNonSubscription[]>;
  subscriptions?: Record<string, RcSubscription>;
}

export interface PlanoConsumivel {
  txKey: string;
  productId: string;
  store: string;
  sandbox: boolean;
}
export interface PlanoAssinatura {
  eventId: string;
  until: string | null;
  status: 'active' | 'cancelled' | 'billing_issue' | 'grace' | 'expired' | 'refunded';
  store: string;
  sandbox: boolean;
}

function ms(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** O que a leitura da RevenueCat manda aplicar. Pura e testada. */
export function planejarSync(
  sub: RcSubscriber | null | undefined,
  agora: number = Date.now(),
): { consumiveis: PlanoConsumivel[]; assinatura: PlanoAssinatura | null } {
  const consumiveis: PlanoConsumivel[] = [];
  for (const [productId, compras] of Object.entries(sub?.non_subscriptions || {})) {
    if (!ehConsumivel(productId) || !Array.isArray(compras)) continue;
    for (const c of compras) {
      // A chave tem que ser a MESMA que o webhook de reembolso manda
      // (`transaction_id` da LOJA), senão o estorno não acha o crédito. A
      // v1 da RevenueCat traz `store_transaction_id` em non_subscriptions;
      // o `id` (interno da RC) fica só de último recurso, com aviso no
      // log — nesse caso um reembolso não é estornado sozinho.
      if (!c?.store_transaction_id && c?.id) {
        console.warn(`[billing] compra ${productId} sem store_transaction_id (id RC ${c.id}) — estorno automático não vai casar`);
      }
      const txKey = chaveDaTransacao(c?.store, c?.store_transaction_id || c?.id);
      if (!txKey) continue;
      consumiveis.push({ txKey, productId, store: String(c.store || '').toLowerCase(), sandbox: c.is_sandbox === true });
    }
  }

  let assinatura: PlanoAssinatura | null = null;
  let melhorFim = -Infinity;
  for (const [productId, s] of Object.entries(sub?.subscriptions || {})) {
    if (!ehProdutoAssinatura(productId) || !s) continue;
    const expira = ms(s.expires_date);
    const carencia = ms(s.grace_period_expires_date);
    const reembolso = ms(s.refunded_at);
    let fim: number | null =
      expira === null && carencia === null ? null : Math.max(expira ?? -Infinity, carencia ?? -Infinity);
    let status: PlanoAssinatura['status'];
    if (reembolso !== null) {
      fim = Math.min(reembolso, agora);
      status = 'refunded';
    } else if (fim === null || fim <= agora) {
      status = 'expired';
    } else if (expira !== null && expira <= agora) {
      status = 'grace';
    } else if (s.billing_issues_detected_at) {
      status = 'billing_issue';
    } else if (s.unsubscribe_detected_at) {
      status = 'cancelled';
    } else {
      status = 'active';
    }
    const ordem = fim ?? -Infinity;
    if (assinatura && ordem <= melhorFim) continue;
    melhorFim = ordem;
    const until = fim === null ? null : new Date(fim).toISOString();
    const store = String(s.store || '').toLowerCase();
    const origem = s.store_transaction_id || s.original_purchase_date || productId;
    assinatura = {
      eventId: `rc-sub:${store}:${origem}:${until ?? 'none'}:${status}`,
      until,
      status,
      store,
      sandbox: s.is_sandbox === true,
    };
  }
  return { consumiveis, assinatura };
}

function rcSecret(): string | undefined {
  return getRuntimeEnv('REVENUECAT_SECRET_KEY') || undefined;
}

export class RevenueCatConfigError extends Error {}

/** Estado vivo do cliente na RevenueCat. */
export async function lerAssinanteRevenueCat(appUserId: string): Promise<RcSubscriber> {
  const key = rcSecret();
  if (!key) throw new RevenueCatConfigError('REVENUECAT_SECRET_KEY ausente');
  const res = await fetch(`${RC_API}/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`RevenueCat ${res.status}: ${txt.slice(0, 200)}`);
  const json = JSON.parse(txt) as { subscriber?: RcSubscriber };
  return json.subscriber || {};
}

async function rpc(nome: string, args: Record<string, unknown>): Promise<string> {
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente');
  const res = await fetch(`${getSupabaseUrl()}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${nome} ${res.status}: ${txt.slice(0, 200)}`);
  try {
    const v = JSON.parse(txt);
    return typeof v === 'string' ? v : String(v);
  } catch {
    return txt;
  }
}

export interface ResultadoSync {
  creditados: number;
  repetidos: number;
  conflitos: number;
  assinatura: PlanoAssinatura | null;
  assinaturaResultado?: string;
}

/** Lê a RevenueCat e aplica no banco. Idempotente. */
export async function sincronizarCompras(userId: string): Promise<ResultadoSync> {
  if (!ehUsuarioValido(userId)) throw new Error('usuário inválido');
  const sub = await lerAssinanteRevenueCat(userId);
  const plano = planejarSync(sub);
  const out: ResultadoSync = { creditados: 0, repetidos: 0, conflitos: 0, assinatura: plano.assinatura };
  for (const c of plano.consumiveis) {
    const r = await rpc('grant_billing_purchase', {
      p_user: userId,
      p_transaction_id: c.txKey,
      p_product_id: c.productId,
      p_platform: c.store,
      p_raw: { source: 'revenuecat', sandbox: c.sandbox },
    });
    if (r === 'granted') out.creditados++;
    else if (r === 'conflict') {
      out.conflitos++;
      console.warn(`[billing] transação ${c.txKey} já pertence a outra conta — não creditada`);
    } else out.repetidos++;
  }
  if (plano.assinatura) {
    out.assinaturaResultado = await rpc('set_pro_subscription', {
      p_user: userId,
      p_event_id: plano.assinatura.eventId,
      p_until: plano.assinatura.until,
      p_status: plano.assinatura.status,
      p_platform: plano.assinatura.store,
      p_raw: { source: 'revenuecat', sandbox: plano.assinatura.sandbox },
    });
  }
  return out;
}

// ── Webhook ──

export interface RcEvento {
  type?: string;
  id?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
  product_id?: string;
  transaction_id?: string;
  store?: string;
  cancel_reason?: string;
}

/** Contas a reler pra um evento (só UUIDs nossos; id anônimo da RC fica de fora). */
export function contasDoEvento(ev: RcEvento | null | undefined): string[] {
  if (!ev) return [];
  const ids = [
    ev.app_user_id,
    ev.original_app_user_id,
    ...(ev.aliases || []),
    ...(ev.transferred_from || []),
    ...(ev.transferred_to || []),
  ];
  return Array.from(new Set(ids.filter(ehUsuarioValido).map((s) => s.toLowerCase())));
}

/** Reembolso de consumível: a RevenueCat manda CANCELLATION com motivo de suporte. */
export function reembolsoDeConsumivel(ev: RcEvento | null | undefined): string | null {
  if (!ev || ev.type !== 'CANCELLATION') return null;
  if (!ev.product_id || !ehConsumivel(ev.product_id)) return null;
  if (ev.cancel_reason && ev.cancel_reason !== 'CUSTOMER_SUPPORT') return null;
  return chaveDaTransacao(ev.store, ev.transaction_id);
}

export async function processarEventoRevenueCat(ev: RcEvento): Promise<{ contas: number; reembolso?: string }> {
  const out: { contas: number; reembolso?: string } = { contas: 0 };
  const tx = reembolsoDeConsumivel(ev);
  if (tx) out.reembolso = await rpc('revoke_billing_purchase', { p_transaction_id: tx, p_raw: { source: 'revenuecat', event: ev.id ?? null } });
  for (const uid of contasDoEvento(ev)) {
    await sincronizarCompras(uid);
    out.contas++;
  }
  return out;
}
