// GET /api/follow-ups-cron
// Processes pending follow-ups whose scheduled_at has arrived.
//
// Can be invoked manually (GET) or via Cloudflare Cron Triggers.
// To configure a cron in wrangler.toml:
//
//   [triggers]
//   crons = ["*/10 * * * *"]
//
// And in the Worker scheduled handler, fetch this endpoint:
//
//   export default {
//     async scheduled(event, env, ctx) {
//       ctx.waitUntil(fetch('https://queroumacor.com/api/follow-ups-cron'));
//     }
//   }
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
    const nowIso = new Date().toISOString();
    const url = `${env.SUPABASE_URL}/rest/v1/follow_ups?status=eq.pending&scheduled_at=lte.${encodeURIComponent(nowIso)}&select=*&limit=100`;

    const r = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
      }
    });
    if (!r.ok) throw new Error(`supabase select follow_ups ${r.status}`);
    const pending = await r.json();

    let processed = 0;
    for (const fu of pending) {
      try {
        // Stub: dispatch as a system bot message into the user's chat thread.
        const msgRow = {
          conversation_id: fu.conversation_id || null,
          sender_id: env.SYSTEM_BOT_USER_ID,
          recipient_id: fu.user_id,
          content: fu.message || 'Olá! Passando para acompanhar seu projeto. Posso ajudar com algo?',
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

        // Mark follow-up as sent
        await fetch(`${env.SUPABASE_URL}/rest/v1/follow_ups?id=eq.${encodeURIComponent(fu.id)}`, {
          method: 'PATCH',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() })
        });

        console.log(`[follow-ups-cron] sent follow-up ${fu.id} to user ${fu.user_id}`);
        processed++;
      } catch (e) {
        console.error(`[follow-ups-cron] failed ${fu?.id}:`, e?.message || e);
      }
    }

    return json({ processed });
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
