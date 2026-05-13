// POST /api/analytics
// Fire-and-forget tolerant analytics ingestion.
// Accepts a single event object or { events: [...] } batch.
// Always responds 200 to avoid breaking the client. Errors are swallowed silently.
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  let count = 0;
  try {
    const body = await request.json().catch(() => ({}));

    const raw = Array.isArray(body?.events) ? body.events : [body];
    const rows = raw
      .filter(e => e && typeof e === 'object' && typeof e.event_name === 'string')
      .map(e => ({
        event_name: String(e.event_name).slice(0, 120),
        props: e.props && typeof e.props === 'object' ? e.props : {},
        session_id: e.session_id ? String(e.session_id).slice(0, 80) : null,
        user_id: e.user_id ? String(e.user_id).slice(0, 80) : null,
        page: e.page ? String(e.page).slice(0, 500) : null,
        referrer: e.referrer ? String(e.referrer).slice(0, 500) : null,
        utm: e.utm && typeof e.utm === 'object' ? e.utm : null,
        created_at: new Date().toISOString()
      }));

    if (rows.length && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      try {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/analytics_events`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(rows)
        });
        if (r.ok) count = rows.length;
      } catch (_) {
        // swallow — never break the client
      }
    }
  } catch (_) {
    // swallow — always respond 200
  }

  return json({ ok: true, count });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}
