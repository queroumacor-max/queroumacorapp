// Webhook do Mercado Pago: confirma a assinatura e libera/revoga o PRO no Supabase.
// Requer no Cloudflare Pages: MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Opcional (recomendado): MP_WEBHOOK_SECRET — quando definido, valida o header
// x-signature (HMAC-SHA256) enviado pelo MP. Sem o secret, a verificação é
// pulada (fail-open) para preservar o comportamento atual.
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

  // Responde 200 mesmo em erro de config para o MP não ficar reenviando infinitamente.
  if (!env.MP_ACCESS_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return ok('config ausente');
  }

  const type = body?.type || body?.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '';
  let preapprovalId =
    body?.data?.id ||
    url.searchParams.get('data.id') ||
    url.searchParams.get('id') ||
    (typeof body?.resource === 'string' ? body.resource.split('/').pop() : '');

  if (!String(type).includes('preapproval') && !String(type).includes('subscription')) {
    return ok('evento ignorado');
  }
  if (!preapprovalId) return ok('sem id');

  // Busca o estado real da assinatura no Mercado Pago (fonte da verdade)
  let pre;
  try {
    const r = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
      headers: { 'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}` }
    });
    if (!r.ok) return ok(`mp ${r.status}`);
    pre = await r.json();
  } catch (e) {
    return ok('erro ao consultar mp');
  }

  const userId = pre?.external_reference;
  if (!userId) return ok('sem external_reference');

  const status = pre?.status; // authorized | paused | cancelled | pending
  const isActive = status === 'authorized';

  const patch = {
    is_pro: isActive,
    mp_preapproval_id: preapprovalId,
    pro_expires_at: isActive
      ? new Date(Date.now() + 33 * 24 * 60 * 60 * 1000).toISOString()
      : null
  };

  const supaUrl = (env.SUPABASE_URL || 'https://uwqebaqweehiljsqkifm.supabase.co').replace(/\/$/, '');
  try {
    const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(patch)
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
export async function onRequestGet() {
  return ok('mp-webhook ativo');
}

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
async function verifyMpSignature(request, env, body) {
  if (!env.MP_WEBHOOK_SECRET) {
    console.warn('mp-webhook: MP_WEBHOOK_SECRET não configurado — pulando verificação de assinatura');
    return true; // fail-open
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
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
