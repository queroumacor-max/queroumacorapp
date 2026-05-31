// @ts-check
// Health check endpoint pra uptime monitoring (Cloudflare Health Checks
// nativo, UptimeRobot, etc.). Resposta sempre 200 — o body conta o que
// está saudável; quem monitora decide o que considera "down".
//
// Uso:
//   curl https://queroumacor.com.br/api/health
//   { "status":"ok", "time":"2026-...", "region":"GRU", "supabase":"ok" }
//
// Configurar no Cloudflare: Dashboard → seu domínio → Health Checks →
// Create. Path: /api/health. Check interval: 60s. Sucesso = 2xx + body
// contém "ok". Notifica por email/webhook quando falhar.

import { FALLBACK_SUPABASE_URL } from './_security.js';

/**
 * @param {{ request: Request, env: Record<string, string>, cf?: { colo?: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { env, cf } = context;

  /** @type {Record<string, any>} */
  const body = {
    status: 'ok',
    time: new Date().toISOString(),
    app: 'queroumacorapp',
    region: (cf && cf.colo) || null,
    version: env.CF_PAGES_COMMIT_SHA || 'unknown'
  };

  // Liveness check do Supabase: ping no /rest/v1/ root com timeout curto.
  // Falha aqui NÃO derruba o health (200 sempre) — só sinaliza no body.
  // Quem monitora pode usar grep "supabase\":\"ok\"" pra checagem profunda.
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  try {
    const r = await fetch(supaUrl + '/rest/v1/', {
      signal: AbortSignal.timeout(2000)
    });
    // 401/404 são respostas válidas do REST (significa "Supabase respondeu").
    // Só consideramos "unreachable" se a request nem completar (timeout/erro).
    body.supabase = r.status > 0 ? 'ok' : 'unreachable';
  } catch (_) {
    body.supabase = 'unreachable';
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}
