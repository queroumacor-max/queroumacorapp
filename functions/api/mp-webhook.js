// Webhook do Mercado Pago: confirma a assinatura e libera/revoga o PRO no Supabase.
// Requer no Cloudflare Pages: MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
export async function onRequestPost(context) {
  const { env, request } = context;
  // Responde 200 mesmo em erro de config para o MP não ficar reenviando infinitamente.
  if (!env.MP_ACCESS_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return ok('config ausente');
  }

  const url = new URL(request.url);
  let body = {};
  try { body = await request.json(); } catch { /* MP às vezes manda só query params */ }

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
