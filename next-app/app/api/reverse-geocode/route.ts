// app/api/reverse-geocode/route.ts — GPS (lat/lng) → cidade/UF.
//
// Feito no servidor de propósito: a CSP do app (connect-src) não libera
// geocoders externos pro browser. O cliente chama /api/reverse-geocode
// (mesma origem) e a edge function fala com o BigDataCloud (gratuito, sem
// chave) por baixo.

import { type NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api/security';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  // Proxy pra geocoder externo (quota/custo) — limita abuso por IP.
  const limited = await enforceRateLimit(request, { endpoint: 'reverse-geocode', limit: 30 });
  if (limited) return limited;
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'lat/lng inválidos' }, { status: 400 });
  }

  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${lat}&longitude=${lng}&localityLanguage=pt`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      return NextResponse.json({ error: 'geocoder indisponível' }, { status: 502 });
    }
    const d = (await r.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      principalSubdivisionCode?: string; // ex.: "BR-SP"
    };
    const city = (d.city || d.locality || '').trim();
    // principalSubdivisionCode vem "BR-SP" → UF "SP". Fallback: nome do estado.
    const uf =
      (d.principalSubdivisionCode || '').split('-')[1]?.trim() ||
      (d.principalSubdivision || '').trim();
    if (!city) {
      return NextResponse.json({ error: 'não foi possível resolver a cidade' }, { status: 404 });
    }
    return NextResponse.json(
      { city, state: uf || null },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return NextResponse.json(
      { error: isTimeout ? 'geocoder demorou demais' : 'erro no geocoder' },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
