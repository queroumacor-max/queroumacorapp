// Webhook da InfinitePay para notificações de pagamento.
//
// IMPORTANTE: A InfinitePay NÃO documenta header de assinatura HMAC.
// Defesas usadas aqui:
//   1. order_nsu é um UUID — atacante não consegue adivinhar
//   2. Conferimos que paid_amount (em centavos) bate com orders.total
//   3. Idempotência via tx_id (transaction_nsu) — não reprocessa
//   4. Só atualizamos quando status atual = 'pending' (não sobrescreve final)
//
// Requer SUPABASE_SERVICE_KEY (a webhook não tem JWT de usuário; precisa
// da service key para escrever na orders sem RLS bloquear).
// Fail-open: se faltar service key, loga warning e devolve 200 (a
// InfinitePay vai parar de tentar). Sem service key não dá pra
// confirmar o pagamento — defina a env var antes de ativar a Loja.

const SUPABASE_URL_FALLBACK = 'https://uwqebaqweehiljsqkifm.supabase.co';

export async function onRequestPost(context) {
  const { env, request } = context;

  let body;
  try { body = await request.json(); }
  catch {
    // Sempre devolve 200 para a InfinitePay parar de tentar; mas loga.
    console.warn('infinitepay-webhook: body não é JSON');
    return ok();
  }

  const orderNsu = String(body?.order_nsu || '').trim();
  const txId = String(body?.transaction_nsu || body?.invoice_slug || '').trim();
  const paidAmountCents = Number(body?.paid_amount || body?.amount || 0);
  const installments = Number(body?.installments || 1);
  const captureMethod = String(body?.capture_method || body?.payment_method || '').trim();
  const receiptUrl = String(body?.receipt_url || '').trim();

  if (!orderNsu || !txId) {
    console.warn('infinitepay-webhook: payload incompleto', { orderNsu, txId });
    return ok();
  }

  const supaUrl = (env.SUPABASE_URL || SUPABASE_URL_FALLBACK).replace(/\/$/, '');
  // Aceita 3 nomes pra compatibilidade com setups existentes
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    console.warn('infinitepay-webhook: SUPABASE_SERVICE_ROLE/SUPABASE_SERVICE_KEY não configurada — não consigo atualizar a order');
    return ok();
  }

  // 1) Busca o pedido
  const getRes = await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderNsu)}&select=id,user_id,total,status,tx_id`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  if (!getRes.ok) {
    console.warn('infinitepay-webhook: erro ao buscar pedido', getRes.status, await getRes.text().catch(() => ''));
    return ok();
  }
  const rows = await getRes.json().catch(() => []);
  const order = Array.isArray(rows) && rows[0];
  if (!order) {
    console.warn('infinitepay-webhook: order não encontrada', orderNsu);
    return ok();
  }

  // 2) Idempotência — se já está paid e tx_id bate, não faz nada
  if (order.status === 'paid' && order.tx_id === txId) {
    return ok();
  }

  // 3) Se já passou de pending (paid, refunded, canceled, etc), não sobrescreve
  if (order.status !== 'pending') {
    console.warn('infinitepay-webhook: order já saiu de pending', orderNsu, order.status);
    return ok();
  }

  // 4) Valida valor — total está em reais, paid_amount em centavos
  const expectedCents = Math.round(Number(order.total || 0) * 100);
  if (paidAmountCents > 0 && Math.abs(paidAmountCents - expectedCents) > 1) {
    console.warn('infinitepay-webhook: paid_amount diverge do total', { orderNsu, paidAmountCents, expectedCents });
    // Marca como suspeito ao invés de paid
    await patchOrder(supaUrl, serviceKey, orderNsu, {
      status: 'amount_mismatch',
      tx_id: txId,
      paid_amount: paidAmountCents / 100,
      payment_method: captureMethod || null
    });
    return ok();
  }

  // 5) Atualiza para paid
  const patch = {
    status: 'paid',
    tx_id: txId,
    paid_amount: paidAmountCents > 0 ? paidAmountCents / 100 : Number(order.total || 0),
    paid_at: new Date().toISOString(),
    payment_method: captureMethod || null,
    installments: installments || 1,
    receipt_url: receiptUrl || null
  };
  const upRes = await patchOrder(supaUrl, serviceKey, orderNsu, patch);
  if (!upRes.ok) {
    console.warn('infinitepay-webhook: update falhou', upRes.status, await upRes.text().catch(() => ''));
    return ok();
  }

  return ok();
}

async function patchOrder(supaUrl, serviceKey, orderId, patch) {
  return fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
}

function ok() {
  return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
}

// Algumas integrações batem GET para "verificação de saúde" — devolva 200.
export async function onRequestGet() {
  return ok();
}
