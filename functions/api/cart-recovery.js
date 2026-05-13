// GET /api/cart-recovery
// Cron-like sweep for abandoned carts older than 4h that have not been notified.
// Sends a system-bot recovery message and marks notified_at=now().
//
// Configure a cron trigger (see follow-ups-cron.js header) to call this hourly:
//   crons = ["0 * * * *"]
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, SYSTEM_BOT_USER_ID

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'SUPABASE não configurado' }, 503);
  }
  if (!env.SYSTEM_BOT_USER_ID) {
    return json({ error: 'SYSTEM_BOT_USER_ID não configurado' }, 503);
  }

  try {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const url = `${env.SUPABASE_URL}/rest/v1/cart_abandoned?recovered=is.false&notified_at=is.null&created_at=lt.${encodeURIComponent(cutoff)}&select=*&limit=200`;

    const r = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
      }
    });
    if (!r.ok) throw new Error(`supabase select cart_abandoned ${r.status}`);
    const carts = await r.json();

    let notified = 0;
    for (const cart of carts) {
      try {
        const total = typeof cart.total === 'number' ? cart.total.toFixed(2) : String(cart.total ?? '0.00');
        const content = `Olá! Você esqueceu R$${total} em produtos no carrinho. Quer terminar a compra? 🛒`;

        const msgRow = {
          conversation_id: cart.conversation_id || null,
          sender_id: env.SYSTEM_BOT_USER_ID,
          recipient_id: cart.user_id,
          content,
          type: 'system',
          created_at: new Date().toISOString()
        };

        await fetch(`${env.SUPABASE_URL}/rest/v1/messages`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify([msgRow])
        });

        await fetch(`${env.SUPABASE_URL}/rest/v1/cart_abandoned?id=eq.${encodeURIComponent(cart.id)}`, {
          method: 'PATCH',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ notified_at: new Date().toISOString() })
        });

        notified++;
      } catch (e) {
        console.error(`[cart-recovery] failed cart ${cart?.id}:`, e?.message || e);
      }
    }

    return json({ notified });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}
