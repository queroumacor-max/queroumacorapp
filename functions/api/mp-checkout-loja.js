// Mercado Pago Checkout Pro para Loja — cria uma preference de pagamento
// avulso (one-shot, NÃO assinatura) para um pedido da loja.
//
// Fluxo:
//   1. Cliente já inseriu uma row em `public.orders` (status='pending')
//   2. Cliente chama POST /api/mp-checkout-loja { orderId, accessToken }
//   3. Validamos JWT no Supabase, conferimos posse + status pending do pedido
//   4. Chamamos POST https://api.mercadopago.com/checkout/preferences
//   5. Devolvemos { init_point, orderId } pro app redirecionar
//
// Env vars necessárias no Cloudflare Pages:
//   - MP_ACCESS_TOKEN (access token de produção do MP — já configurado)
//   - SUPABASE_URL, SUPABASE_ANON_KEY (já configurados)
//   - SUPABASE_SERVICE_ROLE (opcional, fallback se anon não tiver permissão)
import { jsonResponse as json, FALLBACK_SUPABASE_URL, FALLBACK_ANON_KEY } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.MP_ACCESS_TOKEN) {
    return json({ error: 'Pagamento não configurado: defina MP_ACCESS_TOKEN' }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  if (!orderId) return json({ error: 'orderId obrigatório' }, 400);
  if (!accessToken) return json({ error: 'Sessão inválida — faça login' }, 401);

  // Valida JWT no Supabase
  const user = await verifySupabaseToken(accessToken, env);
  if (!user) return json({ error: 'Sessão inválida — faça login novamente' }, 401);

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

  // Busca o pedido com o token do user (RLS filtra automaticamente pra ele)
  const orderRes = await fetch(
    `${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,user_id,total,status,items`,
    { headers: { 'apikey': anonKey, 'Authorization': `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
  );
  if (!orderRes.ok) {
    const txt = (await orderRes.text()).slice(0, 300);
    console.warn('mp-checkout-loja supabase error', orderRes.status, txt);
    return json({ error: 'Falha temporária na consulta — tente de novo' }, 502);
  }
  const rows = await orderRes.json().catch(() => []);
  const order = Array.isArray(rows) && rows[0];
  if (!order) return json({ error: 'Pedido não encontrado' }, 404);
  if (order.user_id !== user.id) return json({ error: 'Pedido não pertence a este usuário' }, 403);
  if (order.status !== 'pending') return json({ error: 'Pedido já processado (status=' + order.status + ')' }, 409);

  // ════════════════════════════════════════════════════════════════════
  // ANTI-TAMPERING: re-valida preços contra products no servidor.
  // Antes, cliente forjava cartItems = [{id, price: 0.01}] no devtools,
  // inseria a order com total=0.01, e MP cobrava 1 centavo. Agora a
  // gente IGNORA o price do cliente — só o id do produto é confiável.
  // ════════════════════════════════════════════════════════════════════
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    // Sem service key não dá pra validar preços. Fail-closed em prod
    // pra não permitir tampering passar.
    return json({ error: 'Validação de preços indisponível — contate o suporte' }, 503);
  }

  const rawItems = Array.isArray(order.items) ? order.items : [];
  const productIds = rawItems
    .map(it => String(it.id || '').trim())
    .filter(Boolean);

  if (productIds.length === 0) {
    return json({ error: 'Pedido vazio (sem itens válidos)' }, 400);
  }

  // Busca os produtos REAIS no banco (com service_role pra bypassar RLS)
  const idsList = productIds.map(id => '"' + encodeURIComponent(id).replace(/"/g, '') + '"').join(',');
  const prodRes = await fetch(
    `${supaUrl}/rest/v1/products?id=in.(${idsList})&select=id,name,price,active`,
    { headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey }, signal: AbortSignal.timeout(10000) }
  );
  if (!prodRes.ok) {
    return json({ error: 'Falha ao validar preços dos produtos' }, 502);
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
      return json({ error: 'Produto não encontrado: ' + id }, 400);
    }
    if (prod.active === false) {
      return json({ error: 'Produto inativo: ' + (prod.name || id) }, 400);
    }
    const realPrice = Number(prod.price || 0);
    if (!(realPrice > 0)) {
      return json({ error: 'Produto sem preço cadastrado: ' + (prod.name || id) }, 400);
    }
    const qty = Math.max(1, Math.floor(Number(it.qty || it.quantity || 1)));
    if (qty > 50) {
      return json({ error: 'Quantidade excessiva em ' + (prod.name || id) }, 400);
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
    return json({ error: 'Total inválido após validação' }, 400);
  }

  // Se cliente tentou forjar o total, corrige no DB ANTES de criar a preference
  // (importante porque o webhook depois compara paid_amount com order.total)
  const totalReais = validatedTotal;
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

  const finalItems = validatedItems;

  // Origem hardcoded — evita Host header forge (proxy/CDN poderia
  // forwardar Host arbitrário e MP redirecionar pra attacker.com)
  const origin = 'https://queroumacor.com.br';

  const pref = {
    items: finalItems,
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
      return json({ error: 'Falha temporária no pagamento — tente de novo' }, 502);
    }
    const initPoint = data.init_point || data.sandbox_init_point;
    if (!initPoint) return json({ error: 'Mercado Pago não retornou init_point' }, 502);

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

    return json({ init_point: initPoint, orderId, preference_id: data.id || null });
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) return json({ error: 'Mercado Pago timeout (15s) — tente de novo' }, 504);
    console.warn('mp-checkout-loja: exception', e && e.message || e);
    return json({ error: 'Erro interno — tente de novo em instantes' }, 500);
  }
}

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
