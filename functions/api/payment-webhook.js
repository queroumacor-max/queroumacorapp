// POST /api/payment-webhook
// Agnostic webhook stub for Mercado Pago / Stripe / Asaas.
// Updates profiles subscription fields and logs every event in subscription_events.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   (optional) MP_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET, ASAAS_WEBHOOK_TOKEN

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature, X-Signature, Asaas-Access-Token'
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'SUPABASE não configurado' }, 503);
  }

  // TODO(security): validate signature per provider before trusting payload.
  //   - Stripe: verify header 'Stripe-Signature' with HMAC-SHA256(env.STRIPE_WEBHOOK_SECRET, rawBody)
  //   - Mercado Pago: verify header 'x-signature' / 'x-request-id' with env.MP_WEBHOOK_SECRET
  //   - Asaas: compare header 'asaas-access-token' with env.ASAAS_WEBHOOK_TOKEN
  // Until implemented, this endpoint MUST be treated as untrusted.

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const provider = String(body?.provider || '').slice(0, 30);
  const event = String(body?.event || '').slice(0, 60);
  const customer_id = body?.customer_id ? String(body.customer_id).slice(0, 120) : null;
  const subscription_id = body?.subscription_id ? String(body.subscription_id).slice(0, 120) : null;
  const status = body?.status ? String(body.status).slice(0, 40) : null;
  const amount = typeof body?.amount === 'number' ? body.amount : null;
  const plan_tier = body?.plan_tier ? String(body.plan_tier).slice(0, 40) : null;
  const user_id = body?.user_id_meta ? String(body.user_id_meta) : null;

  if (!event) return json({ error: 'event obrigatório' }, 400);

  try {
    // 1) Log raw event
    await supabaseInsert(env, 'subscription_events', [{
      provider,
      event,
      user_id,
      customer_id,
      subscription_id,
      status,
      amount,
      plan_tier,
      raw_payload: body,
      created_at: new Date().toISOString()
    }]);

    // 2) Compute profile patch based on event type
    if (user_id) {
      const now = new Date();
      const patch = { payment_customer_id: customer_id };

      switch (event) {
        case 'trial_started': {
          const trialEnds = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          patch.subscription_status = 'trialing';
          patch.subscription_tier = plan_tier || 'pro';
          patch.trial_ends_at = trialEnds.toISOString();
          break;
        }
        case 'subscription.created':
        case 'subscription.updated': {
          patch.subscription_status = status || 'active';
          if (plan_tier) patch.subscription_tier = plan_tier;
          if (body?.subscription_ends_at) patch.subscription_ends_at = body.subscription_ends_at;
          break;
        }
        case 'subscription.canceled': {
          patch.subscription_status = 'canceled';
          patch.subscription_ends_at = body?.subscription_ends_at || now.toISOString();
          break;
        }
        case 'payment.succeeded': {
          patch.subscription_status = 'active';
          if (body?.subscription_ends_at) patch.subscription_ends_at = body.subscription_ends_at;
          break;
        }
        case 'payment.failed': {
          patch.subscription_status = 'past_due';
          break;
        }
        default:
          // No-op for unknown event types
          break;
      }

      await supabasePatch(env, 'profiles', `id=eq.${encodeURIComponent(user_id)}`, patch);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

async function supabaseInsert(env, table, rows) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error(`supabase insert ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function supabasePatch(env, table, filter, patch) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
  if (!r.ok) throw new Error(`supabase patch ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}
