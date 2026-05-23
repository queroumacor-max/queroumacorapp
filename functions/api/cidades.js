// Proxy do IBGE: GET /api/cidades?uf=SP -> { uf, cidades: [{nome}] }
// Cacheia no edge do Cloudflare por 30 dias (cidades quase não mudam) e
// no navegador por 1 dia. Após o primeiro request por UF, vira hit do
// edge — IBGE só é chamado uma vez por região.
export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const uf = String(url.searchParams.get('uf') || '').trim().toUpperCase();
  if (!uf || !/^[A-Z]{2}$/.test(uf)) {
    return json({ error: 'uf inválido' }, 400);
  }
  try {
    const r = await fetch(
      'https://servicodados.ibge.gov.br/api/v1/localidades/estados/' + uf + '/municipios?orderBy=nome',
      { cf: { cacheTtl: 2592000, cacheEverything: true } }
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
    return json({ error: String(e && e.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
