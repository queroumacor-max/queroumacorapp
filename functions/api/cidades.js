// @ts-check
// Proxy do IBGE: GET /api/cidades?uf=SP -> { uf, cidades: [{nome}] }
// Cacheia no edge do Cloudflare por 30 dias (cidades quase não mudam) e
// no navegador por 1 dia. Após o primeiro request por UF, vira hit do
// edge — IBGE só é chamado uma vez por região.
import { jsonResponse as json } from './_security.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const uf = String(url.searchParams.get('uf') || '').trim().toUpperCase();
  // Whitelist das 27 UFs do Brasil. Antes /^[A-Z]{2}$/ aceitava qualquer
  // par de letras (ex.: "ZZ"), que ia bater no IBGE e voltar 404. Whitelist
  // barra cedo e evita request desnecessário pro IBGE.
  const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  if (!UFS.includes(uf)) {
    return json({ error: 'UF inválida' }, 400);
  }
  try {
    const r = await fetch(
      'https://servicodados.ibge.gov.br/api/v1/localidades/estados/' + uf + '/municipios?orderBy=nome',
      { cf: { cacheTtl: 2592000, cacheEverything: true }, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) {
      return json({ error: 'IBGE ' + r.status }, 502);
    }
    const data = await r.json();
    const cidades = (data || []).map(c => ({ nome: c.nome }));
    return new Response(JSON.stringify({ uf, cidades }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=86400, s-maxage=2592000'
      }
    });
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) return json({ error: 'IBGE timeout (10s) — tente de novo' }, 504);
    console.warn('cidades: exception', e && e.message || e);
    return json({ error: 'Erro interno — tente de novo em instantes' }, 500);
  }
}
