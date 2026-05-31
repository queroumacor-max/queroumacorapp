// @ts-check
// Business logic do proxy IBGE de cidades por UF.
// Não conhece Request/Response — recebe (uf, env) e devolve dados +
// metadado de origem ('kv' | 'origin+kv' | 'origin'). Controller cuida
// de HTTP, headers (X-Cache), cache-control e error→Response.
//
// Estratégia de cache:
//   - Lookup em Cloudflare KV (binding `env.KV`) por `cidades:<UF>`.
//   - HIT → retorna direto, sem bater no IBGE.
//   - MISS → fetch IBGE, escreve no KV com TTL 7d (não bloqueia retorno
//     com `.catch(()=>{})`; falha de escrita no KV não derruba request).
//   - BYPASS → se `env.KV` não estiver bindada (dev local, config errada,
//     ou ambiente de teste), pula KV totalmente. Sem fallback degradado:
//     funciona como antes, bate IBGE direto a cada request.
//
// Por que o serviço retorna `source` em vez de injetar header X-Cache:
// services não conhecem HTTP. Controller traduz `source` → header.
import { ServiceError } from '../_security.js';

const IBGE_TIMEOUT_MS = 10000;
const KV_TTL_SECONDS = 7 * 24 * 3600; // 7 dias — cidades quase nunca mudam

// Whitelist das 27 UFs do Brasil. Antes /^[A-Z]{2}$/ aceitava qualquer
// par de letras (ex.: "ZZ") que ia bater no IBGE e voltar 404. Whitelist
// barra cedo e evita request desnecessário pro IBGE.
const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

/**
 * Lookup de cidades por UF, com cache em Cloudflare KV.
 * @param {string} ufRaw UF crua do request (qualquer case)
 * @param {{ KV?: { get: (k:string, t?:string)=>Promise<any>, put: (k:string, v:string, opts?:any)=>Promise<void> } } & Record<string, unknown>} env
 * @returns {Promise<{ uf: string, cidades: Array<{nome:string}>, source: 'kv'|'origin+kv'|'origin' }>}
 */
export async function getCidades(ufRaw, env) {
  const uf = String(ufRaw || '').trim().toUpperCase();
  if (!UFS.includes(uf)) {
    throw new ServiceError('UF inválida', 400);
  }

  const key = `cidades:${uf}`;
  const hasKV = !!(env && env.KV && typeof env.KV.get === 'function');

  // KV HIT path. Catch isolada — falha de KV não pode derrubar o endpoint.
  if (hasKV) {
    try {
      const cached = await env.KV.get(key, 'json');
      if (Array.isArray(cached) && cached.length > 0) {
        return { uf, cidades: cached, source: 'kv' };
      }
    } catch (e) {
      // Loga e segue pra origem. Eventually-consistent, sem garantias.
      console.warn('cidades KV.get falhou:', e && e.message || e);
    }
  }

  // MISS (ou BYPASS) — bate no IBGE
  const fresh = await fetchFromIbge(uf);

  // Best-effort write-back. NÃO aguarda — usa .catch pra silenciar.
  if (hasKV) {
    try {
      env.KV.put(key, JSON.stringify(fresh), { expirationTtl: KV_TTL_SECONDS })
        .catch(e => console.warn('cidades KV.put falhou:', e && e.message || e));
    } catch (e) {
      console.warn('cidades KV.put sync throw:', e && e.message || e);
    }
  }

  return { uf, cidades: fresh, source: hasKV ? 'origin+kv' : 'origin' };
}

/**
 * Fetch + normalização do payload IBGE. Throw ServiceError pra erros
 * do upstream (502/504) — controller traduz pra Response.
 * @param {string} uf UF já validada (2 letras, upper)
 * @returns {Promise<Array<{nome:string}>>}
 */
async function fetchFromIbge(uf) {
  let r;
  try {
    r = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
      {
        // Mantém o cache-everything de antes: edge do CF ainda cacheia
        // a chamada outbound; KV é a camada de cima.
        cf: { cacheTtl: 2592000, cacheEverything: true },
        signal: AbortSignal.timeout(IBGE_TIMEOUT_MS)
      }
    );
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) throw new ServiceError('IBGE timeout (10s) — tente de novo', 504, { retry_after: 30 });
    console.warn('cidades: exception no fetch IBGE', e && e.message || e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
  if (!r.ok) {
    throw new ServiceError(`IBGE ${r.status}`, 502, { retry_after: 60 });
  }
  const data = await r.json();
  return (data || []).map(c => ({ nome: c.nome }));
}
