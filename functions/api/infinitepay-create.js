// Cria um link de pagamento na InfinitePay para um pedido da loja.
// Fluxo:
//   1. Cliente já inseriu uma row em `public.orders` (status='pending')
//   2. Cliente chama POST /api/infinitepay-create { orderId, accessToken }
//   3. Validamos o token no Supabase, conferimos que o orderId pertence ao
//      user e ainda está pending, e pegamos o total em centavos
//   4. Chamamos POST https://api.checkout.infinitepay.io/links com
//      order_nsu = orderId (UUID — impossível adivinhar)
//   5. Devolvemos { url } para o app redirecionar o usuário
//
// Env vars necessárias no Cloudflare Pages:
//   - INFINITEPAY_HANDLE  (o "InfiniteTag" público da conta lojista)
//   - SUPABASE_URL        (já configurado)
//   - SUPABASE_ANON_KEY   (já configurado)
//   - SUPABASE_SERVICE_KEY (para ler orders sem RLS bloquear) — opcional;
//     se não tiver, faz select como anon e depende das RLS atuais.

const SUPABASE_URL_FALLBACK = 'https://uwqebaqweehiljsqkifm.supabase.co';
const SUPABASE_ANON_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cWViYXF3ZWVoaWxqc3FraWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjYzMjgsImV4cCI6MjA4OTgwMjMyOH0.yp-z4iMifiOV3ftLVIHOFEQBLcMBdU8VFok7VKlSFg8';

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.INFINITEPAY_HANDLE) {
    return json({ error: 'InfinitePay não configurado: defina INFINITEPAY_HANDLE no Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  if (!orderId) return json({ error: 'orderId obrigatório' }, 400);
  if (!accessToken) return json({ error: 'accessToken obrigatório' }, 401);

  // Valida token no Supabase
  const user = await verifySupabaseToken(accessToken, env);
  if (!user) return json({ error: 'Sessão inválida — faça login novamente' }, 401);

  // Busca o pedido. Como temos a sessão do user, usamos a anon + Authorization
  // para que a RLS já filtre para esse user_id.
  const supaUrl = (env.SUPABASE_URL || SUPABASE_URL_FALLBACK).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;
  const orderRes = await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,user_id,total,status,items`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${accessToken}` }
  });
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
  const totalCents = Math.round(totalReais * 100);

  // Monta o payload da InfinitePay. price em centavos.
  const items = Array.isArray(order.items) && order.items.length
    ? order.items.map(it => ({
        quantity: Math.max(1, Number(it.qty || it.quantity || 1)),
        price: Math.round(Number(it.price || 0) * 100),
        description: String(it.name || it.description || 'Item').slice(0, 80)
      }))
    : [{ quantity: 1, price: totalCents, description: 'Pedido ' + orderId.slice(0, 8) }];

  // Sanity: soma dos itens precisa bater com o total (evita cliente forjar
  // items mais baratos que o total). Se diverge, força um item único.
  const itemsSum = items.reduce((s, it) => s + (it.price * it.quantity), 0);
  const finalItems = itemsSum === totalCents
    ? items
    : [{ quantity: 1, price: totalCents, description: 'Pedido ' + orderId.slice(0, 8) }];

  const origin = (() => {
    try { return new URL(request.url).origin; }
    catch { return 'https://queroumacor.com.br'; }
  })();

  const payload = {
    handle: env.INFINITEPAY_HANDLE,
    redirect_url: origin + '/?compra=' + encodeURIComponent(orderId),
    webhook_url: origin + '/api/infinitepay-webhook',
    order_nsu: orderId,
    items: finalItems
  };

  try {
    const r = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) {
      return json({ error: 'InfinitePay ' + r.status + ': ' + text.slice(0, 300) }, 502);
    }
    let data; try { data = JSON.parse(text); } catch { data = {}; }

    // A InfinitePay não documenta um nome único de campo — tentamos os
    // candidatos mais prováveis.
    const url = data.url || data.payment_url || data.link || data.checkout_url || data.short_url || '';
    if (!url) {
      return json({ error: 'InfinitePay não retornou URL de pagamento', raw: text.slice(0, 300) }, 502);
    }

    // Marca o pedido com gateway + payment_url para reuso (e UI mostrar
    // "continuar pagamento"). Usa o JWT do user via anon key — depende de
    // RLS de UPDATE no orders para o próprio user.
    await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ gateway: 'infinitepay', payment_url: url })
    }).catch(() => { /* não bloquear o checkout se update falhar */ });

    return json({ url, orderId });
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
