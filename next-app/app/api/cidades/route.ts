// app/api/cidades/route.ts — port de `functions/api/cidades.js` +
// `functions/api/_services/cidades.js`. Proxy IBGE de cidades por UF.
//
// Cache:
//   - Vanilla: Cloudflare KV (`env.KV.get`/`put`) com TTL 7d. Bypass quando
//     binding ausente.
//   - Next port (esta sessão): SEM cache de aplicação. Confiamos em:
//       (a) cache HTTP do Next (`fetch` + `next: { revalidate }`) na fetch
//           outbound pro IBGE — vira cache compartilhado na build edge;
//       (b) `Cache-Control: public, max-age=86400, s-maxage=2592000` no
//           response, que o CDN à frente (CF Pages / Vercel Edge Network)
//           respeita.
//   - TODO migration: integrar KV propriamente. Opções:
//       * Cloudflare Pages: usar `@cloudflare/next-on-pages` binding
//         (`getRequestContext().env.KV.get/put`) — runtime edge nativo.
//       * Vercel: `@vercel/kv` (Redis-backed) ou `unstable_cache` do Next.
//     Decidir quando finalizarmos runtime de deploy. Header `X-Cache`
//     fica `BYPASS` até lá (igual ao vanilla quando binding ausente).
//
// X-Cache: HIT=KV, MISS=KV vazio (populou), BYPASS=sem cache de app.

import { type NextRequest, NextResponse } from 'next/server';
import { ServiceError, serviceErrorResponse, enforceRateLimit } from '@/lib/api/security';

export const runtime = 'edge';

const IBGE_TIMEOUT_MS = 10000;

// Whitelist das 27 UFs do Brasil — vanilla barra ZZ antes de bater no IBGE.
const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]);

interface IbgeMunicipio {
  nome: string;
}

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, { endpoint: 'cidades', limit: 60 });
  if (limited) return limited;
  try {
    const ufRaw = request.nextUrl.searchParams.get('uf') || '';
    const uf = ufRaw.trim().toUpperCase();
    if (!UFS.has(uf)) {
      throw new ServiceError('UF inválida', 400);
    }
    const cidades = await fetchFromIbge(uf);
    return NextResponse.json(
      { uf, cidades },
      {
        headers: {
          'cache-control': 'public, max-age=86400, s-maxage=2592000',
          'x-cache': 'BYPASS', // TODO: HIT/MISS quando KV integrado
        },
      }
    );
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('cidades: exception', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno — tente de novo em instantes' }, { status: 500 });
  }
}

async function fetchFromIbge(uf: string): Promise<IbgeMunicipio[]> {
  let res: Response;
  try {
    res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
      {
        // Cache outbound via Next data cache (30 dias). Equivale ao
        // `cf.cacheTtl/cacheEverything` do vanilla — só que portável
        // entre Vercel e CF Pages.
        next: { revalidate: 2592000 },
        signal: AbortSignal.timeout(IBGE_TIMEOUT_MS),
      }
    );
  } catch (e) {
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError('IBGE timeout (10s) — tente de novo', 504, { retry_after: 30 });
    }
    console.warn('cidades: exception no fetch IBGE', e instanceof Error ? e.message : e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
  if (!res.ok) {
    throw new ServiceError(`IBGE ${res.status}`, 502, { retry_after: 60 });
  }
  const data = (await res.json()) as Array<{ nome?: unknown }>;
  return (data || [])
    .filter((c): c is { nome: string } => typeof c.nome === 'string')
    .map((c) => ({ nome: c.nome }));
}
