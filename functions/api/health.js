// @ts-check
// Controller fino — health check pra uptime monitoring (Cloudflare nativo,
// UptimeRobot, etc.). Resposta sempre 200; body conta o que está saudável.
// Lógica em `./_services/health.js`. Setup: Dashboard CF → Health Checks,
// path /api/health, intervalo 60s.
import { getHealth } from './_services/health.js';

/**
 * @param {{ request: Request, env: Record<string, string>, cf?: { colo?: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequest({ env, cf }) {
  const body = await getHealth({ env, colo: (cf && cf.colo) || null });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}
