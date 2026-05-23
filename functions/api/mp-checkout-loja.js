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

const SUPABASE_URL_FALLBACK = 'https://uwqebaqweehiljsqkifm.supabase.co';
const SUPABASE_ANON_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cWViYXF3ZWVoaWxqc3FraWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjYzMjgsImV4cCI6MjA4OTgwMjMyOH0.yp-z4iMifiOV3ftLVIHOFEQBLcMBdU8VFok7VKlSFg8';

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

  const supaUrl = (env.SUPABASE_URL || SUPABASE_URL_FALLBACK).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;

  // Busca o pedido com o token do user (RLS filtra automaticamente pra ele)
  const orderRes = await fetch(
    `${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,user_id,total,status,items`,
    { headers: { 'apikey': anonKey, 'Authorization': `Bearer ${accessToken}` } }
  );
  if (!orderRes.ok) {
    return json({ error: 'Supabase ' + orderRes.status + ': ' + (await orderRes.text()).slice(0, 200) }, 502);
  }
  const rows = await orderRes.json().catch(() => []);
  const order = Array.isArray(rows) && rows[0];
  if (!order) return json({ error: 'Pedido não encontrado' }, 404);
  if (order.user_id !== user.id) return json({ error: 'Pedido não pertence a este usuário' }, 403);
  if (order.status !== 'pending') return json({ error: 'Pedido já processado (status=' + order.status + ')' }, 409);

  const totalReais = Number(order.total || 0);
  if (!(totalReais > 0)) return json({ error: 'Total do pedido inválido' }, 400);

  // Monta items pro MP. Preço em DECIMAL (não centavos como o InfinitePay).
  const items = (Array.isArray(order.items) && order.items.length)
    ? order.items.map((it, i) => ({
        id: String(it.id || ('item-' + i)),
        title: String(it.name || it.description || 'Item').slice(0, 80),
        quantity: Math.max(1, Math.floor(Number(it.qty || it.quantity || 1))),
        unit_price: Number(Number(it.price || 0).toFixed(2)) || 0,
        currency_id: 'BRL'
      }))
    : [{
        id: 'pedido-' + orderId.slice(0, 8),
        title: 'Pedido #' + orderId.slice(0, 8),
        quantity: 1,
        unit_price: Number(totalReais.toFixed(2)),
        currency_id: 'BRL'
      }];

  // Sanity: se soma dos items diverge do total, força um item único com total
  const itemsSum = items.reduce((s, it) => s + (it.unit_price * it.quantity), 0);
  const finalItems = (Math.abs(itemsSum - totalReais) < 0.01)
    ? items
    : [{
        id: 'pedido-' + orderId.slice(0, 8),
        title: 'Pedido #' + orderId.slice(0, 8),
        quantity: 1,
        unit_price: Number(totalReais.toFixed(2)),
        currency_id: 'BRL'
      }];

  const origin = (() => {
    try { return new URL(request.url).origin; }
    catch { return 'https://queroumacor.com.br'; }
  })();

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
      body: JSON.stringify(pref)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({
        error: 'Mercado Pago ' + r.status + ': ' + ((data?.message || data?.error || JSON.stringify(data)).slice(0, 300))
      }, 502);
    }
    const initPoint = data.init_point || data.sandbox_init_point;
    if (!initPoint) return json({ error: 'Mercado Pago não retornou init_point' }, 502);

    // Marca o pedido com gateway + payment_url
    await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ gateway: 'mp', payment_url: initPoint })
    }).catch(() => { /* não bloqueia checkout se update falhar */ });

    return json({ init_point: initPoint, orderId, preference_id: data.id || null });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

async function verifySupabaseToken(token, env) {
  const supaUrl = (env.SUPABASE_URL || SUPABASE_URL_FALLBACK).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey }
    });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    if (!u || typeof u.id !== 'string' || !u.id) return null;
    return { id: u.id, email: typeof u.email === 'string' ? u.email : '' };
  } catch {
    return null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
