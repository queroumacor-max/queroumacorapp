// @ts-check
// Webhook do Mercado Pago: confirma a assinatura e libera/revoga o PRO no Supabase.
// Requer no Cloudflare Pages: MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Opcional (recomendado): MP_WEBHOOK_SECRET — quando definido, valida o header
// x-signature (HMAC-SHA256) enviado pelo MP. Sem o secret, a verificação é
// pulada (fail-open) para preservar o comportamento atual.
import { FALLBACK_SUPABASE_URL } from './_security.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  const url = new URL(request.url);
  let body = {};
  try { body = await request.json(); } catch { /* MP às vezes manda só query params */ }

  // Validação da assinatura do MP. Se o secret não estiver configurado,
  // segue com warning (fail-open). Se estiver configurado e bater errado,
  // rejeita com 401 (não retorna 200, para o atacante perceber que está
  // sendo barrado — o MP real só envia assinatura válida).
  const sigOk = await verifyMpSignature(request, env, body);
  if (!sigOk) {
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  // Aceita 3 nomes de service key pra compatibilidade
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  // Responde 200 mesmo em erro de config para o MP não ficar reenviando infinitamente.
  if (!env.MP_ACCESS_TOKEN || !serviceKey) {
    return ok('config ausente');
  }

  const type = body?.type || body?.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '';
  const eventId =
    body?.data?.id ||
    url.searchParams.get('data.id') ||
    url.searchParams.get('id') ||
    (typeof body?.resource === 'string' ? body.resource.split('/').pop() : '');

  const isPreapproval = String(type).includes('preapproval') || String(type).includes('subscription');
  const isPayment = String(type) === 'payment' || String(type) === 'payment.created' || String(type) === 'payment.updated';

  if (!isPreapproval && !isPayment) {
    return ok('evento ignorado');
  }
  if (!eventId) return ok('sem id');

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const sHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  // -------------------- LOJA (one-shot payment) --------------------
  if (isPayment) {
    let pay;
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(eventId)}`, {
        headers: { 'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}` },
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) return ok(`mp payment ${r.status}`);
      pay = await r.json();
    } catch (e) {
      return ok('erro ao consultar payment');
    }

    const orderId = pay?.external_reference;
    if (!orderId) return ok('payment sem external_reference');

    const status = pay?.status; // approved | rejected | refunded | cancelled | pending
    const transactionAmount = Number(pay?.transaction_amount || 0);
    const paymentMethod = pay?.payment_type_id || pay?.payment_method_id || null;

    // Busca a order pra validar valor + idempotência
    const getR = await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,total,status,tx_id`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!getR.ok) return ok(`supabase get order ${getR.status}`);
    const rows = await getR.json().catch(() => []);
    const order = Array.isArray(rows) && rows[0];
    if (!order) return ok('order não encontrada');

    // Idempotência: se já é paid e tx_id bate, não faz nada
    if (order.status === 'paid' && order.tx_id === String(eventId)) {
      return ok('idempotente');
    }
    // Não sobrescreve estado final
    if (order.status !== 'pending' && status === 'approved') {
      return ok('order já fora de pending');
    }

    let patch;
    if (status === 'approved') {
      // Valida valor (anti-fraude)
      const expected = Number(order.total || 0);
      if (transactionAmount > 0 && Math.abs(transactionAmount - expected) > 0.01) {
        patch = {
          status: 'amount_mismatch',
          tx_id: String(eventId),
          paid_amount: transactionAmount,
          payment_method: paymentMethod
        };
      } else {
        patch = {
          status: 'paid',
          tx_id: String(eventId),
          paid_amount: transactionAmount || expected,
          paid_at: new Date().toISOString(),
          payment_method: paymentMethod,
          gateway: 'mp'
        };
      }
    } else if (status === 'refunded' || status === 'cancelled' || status === 'rejected') {
      patch = { status: status === 'rejected' ? 'canceled' : status };
    } else {
      return ok('payment status ' + status + ' — sem ação');
    }

    const upR = await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: sHeaders,
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10000)
    });
    if (!upR.ok) {
      const t = await upR.text();
      return ok(`supabase update ${upR.status}: ${t.slice(0, 150)}`);
    }
    return ok('order ' + (patch.status || 'updated'));
  }

  // -------------------- PRO (preapproval) --------------------
  // Busca o estado real da assinatura no Mercado Pago (fonte da verdade)
  let pre;
  try {
    const r = await fetch(`https://api.mercadopago.com/preapproval/${eventId}`, {
      headers: { 'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return ok(`mp ${r.status}`);
    pre = await r.json();
  } catch (e) {
    return ok('erro ao consultar mp');
  }

  const userId = pre?.external_reference;
  if (!userId) return ok('sem external_reference');

  const status = pre?.status; // authorized | paused | cancelled | pending
  // Valida valor da assinatura PRO (anti-fraude: atacante criava preapproval
  // de R$ 1 e o webhook ativava PRO mesmo assim)
  const proAmount = Number(pre?.auto_recurring?.transaction_amount || 0);
  const proCurrency = String(pre?.auto_recurring?.currency_id || '');
  const EXPECTED_PRO_AMOUNT = 39;

  let patch;
  if (status === 'authorized') {
    if (proCurrency !== 'BRL' || Math.abs(proAmount - EXPECTED_PRO_AMOUNT) > 0.01) {
      console.warn('mp-webhook: preapproval com valor suspeito, ignorando ativação', {
        userIdPrefix: String(userId).slice(0, 8),
        proAmount,
        proCurrency,
        expected: EXPECTED_PRO_AMOUNT
      });
      return ok('preapproval com valor diferente do esperado');
    }
    patch = {
      is_pro: true,
      mp_preapproval_id: eventId,
      pro_expires_at: new Date(Date.now() + 33 * 24 * 60 * 60 * 1000).toISOString()
    };
  } else if (status === 'cancelled' || status === 'paused') {
    // Desativa só em estados finais — nunca em 'pending' (que é estado
    // intermediário de uma 2ª subscription pendente, e zerar is_pro aqui
    // tira PRO de quem já pagou a 1ª)
    patch = {
      is_pro: false,
      mp_preapproval_id: eventId,
      pro_expires_at: null
    };
  } else {
    // 'pending' ou outros estados não-terminais: NÃO toca em is_pro
    return ok('preapproval status ' + status + ' — sem ação');
  }

  try {
    const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: sHeaders,
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      const t = await r.text();
      return ok(`supabase ${r.status}: ${t.slice(0, 150)}`);
    }
  } catch (e) {
    return ok('erro ao atualizar supabase');
  }

  return ok('ok');
}

// Mercado Pago também faz GET de validação no endpoint
/**
 * @returns {Promise<Response>}
 */
export async function onRequestGet() {
  return ok('mp-webhook ativo');
}

/**
 * @param {string} msg
 * @returns {Response}
 */
function ok(msg) {
  return new Response(JSON.stringify({ received: true, msg }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

// Verifica o header x-signature do Mercado Pago.
// Formato: "ts=<unixtime>,v1=<hmac-sha256-hex>"
// HMAC calculado sobre `id:<dataId>;request-id:<reqId>;ts:<ts>;` usando
// MP_WEBHOOK_SECRET (configurado no painel do MP).
// Fail-open: se MP_WEBHOOK_SECRET não estiver definido, retorna true e loga
// warning — preserva o comportamento atual até o secret ser configurado.
/**
 * @param {Request} request
 * @param {Record<string, string>} env
 * @param {{ data?: { id?: string } } | null | undefined} body
 * @returns {Promise<boolean>}
 */
async function verifyMpSignature(request, env, body) {
  if (!env.MP_WEBHOOK_SECRET) {
    // Fail-open por padrão (preserva o flow enquanto o secret não tá colado
    // no painel MP). Pra fechar de vez, defina MP_WEBHOOK_ENFORCE=true no
    // Cloudflare — aí qualquer webhook sem secret válido é rejeitado.
    if (env.MP_WEBHOOK_ENFORCE === 'true') {
      console.warn('mp-webhook: MP_WEBHOOK_ENFORCE=true mas MP_WEBHOOK_SECRET ausente — rejeitando');
      return false;
    }
    console.warn('mp-webhook: MP_WEBHOOK_SECRET não configurado — pulando verificação (fail-open)');
    return true;
  }
  const sigHeader = request.headers.get('x-signature') || '';
  const reqId = request.headers.get('x-request-id') || '';
  const parts = sigHeader.split(',').reduce((acc, p) => {
    const idx = p.indexOf('=');
    if (idx <= 0) return acc;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  const ts = parts.ts || '';
  const v1 = parts.v1 || '';
  if (!ts || !v1) return false;
  const dataId = (body && body.data && body.data.id) || '';
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.MP_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return timingSafeEqualHex(hex, v1);
  } catch (e) {
    console.warn('mp-webhook: erro ao calcular HMAC:', String(e?.message || e));
    return false;
  }
}

// Comparação em tempo constante para evitar timing attacks
/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
