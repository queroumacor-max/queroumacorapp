// @ts-check
// Controller fino — proxy IBGE de cidades por UF.
// Business logic + cache KV em `./_services/cidades.js`.
// X-Cache: HIT=KV, MISS=KV vazio (populou), BYPASS=KV não bindado.
import { jsonResponse as json, ServiceError } from './_security.js';
import { getCidades } from './_services/cidades.js';

const SOURCE_TO_XCACHE = { 'kv': 'HIT', 'origin+kv': 'MISS', 'origin': 'BYPASS' };

/**
 * @param {{ request: Request, env: Record<string, any>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet({ request, env }) {
  try {
    const { uf, cidades, source } = await getCidades(new URL(request.url).searchParams.get('uf') || '', env);
    return new Response(JSON.stringify({ uf, cidades }), { status: 200, headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=86400, s-maxage=2592000',
      'x-cache': SOURCE_TO_XCACHE[source] || 'BYPASS'
    }});
  } catch (e) {
    if (e instanceof ServiceError) {
      const headers = { 'content-type': 'application/json; charset=utf-8' };
      if (e.extra && typeof e.extra.retry_after === 'number') headers['retry-after'] = String(e.extra.retry_after);
      return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers });
    }
    console.warn('cidades: exception', e && e.message || e);
    return json({ error: 'Erro interno — tente de novo em instantes' }, 500);
  }
}
