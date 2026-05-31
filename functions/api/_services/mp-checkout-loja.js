// @ts-check
// Business logic do checkout MP da Loja.
// Não conhece Request/Response — recebe `orderId` + `accessToken` + `env`
// e devolve `{ init_point, orderId, preference_id }` ou throw ServiceError.
// Controller cuida do parse de body + envelope HTTP.
import { ServiceError, FALLBACK_SUPABASE_URL, FALLBACK_ANON_KEY } from '../_security.js';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Cria a preference do MP Checkout Pro para um pedido da Loja.
 * Throw ServiceError em qualquer falha de validação/integração.
 * @param {{ env: Record<string,string>, orderId: string, accessToken: string }} args
 * @returns {Promise<{ init_point: string, orderId: string, preference_id: string | null }>}
 */
export async function createLojaCheckout({ env, orderId, accessToken }) {
  if (!env.MP_ACCESS_TOKEN) {
    throw new ServiceError('Pagamento não configurado: defina MP_ACCESS_TOKEN', 503);
  }
  if (!orderId) throw new ServiceError('orderId obrigatório', 400);
  if (!accessToken) throw new ServiceError('Sessão inválida — faça login', 401);

  // Valida JWT no Supabase
  const user = await verifySupabaseToken(accessToken, env);
  if (!user) throw new ServiceError('Sessão inválida — faça login novamente', 401);

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

  // Busca o pedido com o token do user (RLS filtra automaticamente pra ele)
  const order = await fetchOrder({ supaUrl, anonKey, accessToken, orderId });
  if (order.user_id !== user.id) throw new ServiceError('Pedido não pertence a este usuário', 403);
  if (order.status !== 'pending') throw new ServiceError('Pedido já processado (status=' + order.status + ')', 409);

  // ANTI-TAMPERING: re-valida preços contra products no servidor.
  const serviceKey = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new ServiceError('Validação de preços indisponível — contate o suporte', 503);
  }

  const { validatedItems, validatedTotal } = await validateItemsAgainstProducts({
    supaUrl, serviceKey, rawItems: Array.isArray(order.items) ? order.items : []
  });

  // Se cliente forjou o total, corrige no DB ANTES de criar a preference
  // (importante porque o webhook depois compara paid_amount com order.total)
  if (Math.abs(Number(order.total || 0) - validatedTotal) > 0.01) {
    console.warn('mp-checkout-loja: total adulterado pelo cliente, corrigindo', {
      orderIdPrefix: String(orderId).slice(0, 8),
      cliente: order.total,
      real: validatedTotal
    });
    await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ total: validatedTotal }),
      signal: AbortSignal.timeout(10000)
    }).catch(() => {});
  }

  // Origem hardcoded — evita Host header forge (proxy/CDN poderia
  // forwardar Host arbitrário e MP redirecionar pra attacker.com)
  const origin = 'https://queroumacor.com.br';

  const pref = {
    items: validatedItems,
    payer: user.email ? { email: user.email } : undefined,
    external_reference: orderId,
    statement_descriptor: 'QueroUmaCor',
    back_urls: {
      success: origin + '/?compra=' + encodeURIComponent(orderId) + '&status=success',
      failure: origin + '/?compra=' + encodeURIComponent(orderId) + '&status=failure',
      pending: origin + '/?compra=' + encodeURIComponent(orderId) + '&status=pending'
    },
    auto_return: 'approved',
    notification_url: origin + '/api/mp-webhook',
    binary_mode: false
  };

  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pref),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data?.message || data?.error || JSON.stringify(data)).slice(0, 300);
      console.warn('mp-checkout-loja MP error', r.status, detail);
      throw new ServiceError('Falha temporária no pagamento — tente de novo', 502);
    }
    const initPoint = data.init_point || data.sandbox_init_point;
    if (!initPoint) throw new ServiceError('Mercado Pago não retornou init_point', 502);

    // Marca o pedido com gateway + payment_url. Usa service_role pq depois
    // do hardening B4 a policy orders_admin_update bloqueia UPDATE pelo
    // próprio user — só admin/service_role pode.
    await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ gateway: 'mp', payment_url: initPoint }),
      signal: AbortSignal.timeout(10000)
    }).catch(() => { /* não bloqueia checkout se update falhar */ });

    return { init_point: initPoint, orderId, preference_id: data.id || null };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) throw new ServiceError('Mercado Pago timeout (15s) — tente de novo', 504);
    console.warn('mp-checkout-loja: exception', e && e.message || e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

async function fetchOrder({ supaUrl, anonKey, accessToken, orderId }) {
  const orderRes = await fetch(
    `${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,user_id,total,status,items`,
    { headers: { 'apikey': anonKey, 'Authorization': `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
  );
  if (!orderRes.ok) {
    const txt = (await orderRes.text()).slice(0, 300);
    console.warn('mp-checkout-loja supabase error', orderRes.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }
  const rows = await orderRes.json().catch(() => []);
  const order = Array.isArray(rows) && rows[0];
  if (!order) throw new ServiceError('Pedido não encontrado', 404);
  return order;
}

async function validateItemsAgainstProducts({ supaUrl, serviceKey, rawItems }) {
  const productIds = rawItems
    .map(it => String(it.id || '').trim())
    .filter(Boolean);

  if (productIds.length === 0) {
    throw new ServiceError('Pedido vazio (sem itens válidos)', 400);
  }

  // Busca os produtos REAIS no banco (com service_role pra bypassar RLS)
  const idsList = productIds.map(id => '"' + encodeURIComponent(id).replace(/"/g, '') + '"').join(',');
  const prodRes = await fetch(
    `${supaUrl}/rest/v1/products?id=in.(${idsList})&select=id,name,price,active`,
    { headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey }, signal: AbortSignal.timeout(10000) }
  );
  if (!prodRes.ok) {
    throw new ServiceError('Falha ao validar preços dos produtos', 502);
  }
  const products = await prodRes.json().catch(() => []);
  const productMap = {};
  (Array.isArray(products) ? products : []).forEach(p => { productMap[p.id] = p; });

  // Re-monta items com preço autoritativo do banco
  const validatedItems = [];
  let validatedTotal = 0;
  for (const it of rawItems) {
    const id = String(it.id || '').trim();
    if (!id) continue;
    const prod = productMap[id];
    if (!prod) {
      throw new ServiceError('Produto não encontrado: ' + id, 400);
    }
    if (prod.active === false) {
      throw new ServiceError('Produto inativo: ' + (prod.name || id), 400);
    }
    const realPrice = Number(prod.price || 0);
    if (!(realPrice > 0)) {
      throw new ServiceError('Produto sem preço cadastrado: ' + (prod.name || id), 400);
    }
    const qty = Math.max(1, Math.floor(Number(it.qty || it.quantity || 1)));
    if (qty > 50) {
      throw new ServiceError('Quantidade excessiva em ' + (prod.name || id), 400);
    }
    validatedItems.push({
      id: prod.id,
      title: String(prod.name || ('Item ' + id)).slice(0, 80),
      quantity: qty,
      unit_price: Number(realPrice.toFixed(2)),
      currency_id: 'BRL'
    });
    validatedTotal += realPrice * qty;
  }
  validatedTotal = Math.round(validatedTotal * 100) / 100;

  if (!(validatedTotal > 0)) {
    throw new ServiceError('Total inválido após validação', 400);
  }
  return { validatedItems, validatedTotal };
}

/**
 * @param {string} token
 * @param {Record<string, string>} env
 * @returns {Promise<{ id: string, email: string } | null>}
 */
async function verifySupabaseToken(token, env) {
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    if (!u || typeof u.id !== 'string' || !u.id) return null;
    return { id: u.id, email: typeof u.email === 'string' ? u.email : '' };
  } catch {
    return null;
  }
}
