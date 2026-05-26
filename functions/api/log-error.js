// Recebe relatórios de erro do front + Web Vitals. Loga no console (Cloudflare).
// Em produção, pode-se encaminhar pra Sentry/PostHog adicionando uma env.
import { checkRateLimit, rateLimitResponse, jsonResponse as json } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;

  let body = {};
  try { body = await request.json(); } catch { return json({ ok: true }, 200); }

  // Rate limit por IP — 60 erros/min por IP
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rl = await checkRateLimit(env, 'ip:' + ip, 'log-error', 60);
  if (!rl.allowed) return rateLimitResponse(rl);

  // Trunca campos pra evitar abuse (max ~2KB no total)
  const trunc = (s, n) => typeof s === 'string' ? s.slice(0, n) : s;
  const safe = {
    type: trunc(body.type, 32),                 // 'error' | 'unhandledrejection' | 'web-vital' | 'manual' | 'pageview'
    msg: trunc(body.msg, 500),
    stack: trunc(body.stack, 1500),
    url: trunc(body.url, 300),
    ua: trunc(body.ua, 200),
    metric: trunc(body.metric, 32),             // pra web-vital: LCP|CLS|INP|FCP|TTFB
    value: typeof body.value === 'number' ? body.value : undefined,
    ctx: trunc(body.ctx, 100),                  // contexto opcional
    ts: Date.now()
  };

  // Cloudflare logs aceitam até ~256KB; isso aqui é tipo 2KB no max
  console.log('[client-log]', JSON.stringify(safe));

  // TODO: forward to Sentry/PostHog/Plausible quando env.SENTRY_DSN existir
  // if (env.SENTRY_DSN) await fetch(env.SENTRY_DSN, { ... });

  return json({ ok: true }, 200);
}

// CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
