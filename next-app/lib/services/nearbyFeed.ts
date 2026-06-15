// nearbyFeed — "Perto de você" (Option A, por cidade/UF). Pede permissão de
// localização, resolve a cidade via /api/reverse-geocode, e acha os user_ids
// de quem é da mesma cidade (fallback UF) pra o feed filtrar por eles.

import { getSupabase } from '@/lib/supabase';

export interface NearbyLocation {
  city: string;
  state: string | null;
}

/** Pede a posição do device. Rejeita com mensagem amigável se negado/sem suporte. */
export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Seu navegador não suporta localização.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Permissão de localização negada.'));
        } else {
          reject(new Error('Não consegui pegar sua localização.'));
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60_000 },
    );
  });
}

/** GPS → cidade/UF via /api/reverse-geocode (server-side). */
export async function resolveCity(lat: number, lng: number): Promise<NearbyLocation> {
  const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
  const data = (await res.json().catch(() => null)) as
    | { city?: string; state?: string | null; error?: string }
    | null;
  if (!res.ok || !data?.city) {
    throw new Error(data?.error || 'Não foi possível resolver sua cidade.');
  }
  return { city: data.city, state: data.state ?? null };
}

/**
 * IDs de usuários da mesma cidade (fallback UF se a cidade tem poucos).
 * Lê de `profiles_public` (city/state públicos). Cap em 500 ids.
 */
export async function fetchNearbyUserIds(loc: NearbyLocation): Promise<string[]> {
  const sb = getSupabase();
  const city = loc.city.trim();
  if (!city) return [];

  const byCity = await sb
    .from('profiles_public')
    .select('id')
    .ilike('city', city)
    .limit(500);
  let ids = ((byCity.data ?? []) as Array<{ id: string | null }>)
    .map((r) => r.id)
    .filter((id): id is string => !!id);

  // Poucos na cidade exata → amplia pro estado pra o feed não ficar vazio.
  if (ids.length < 3 && loc.state) {
    const byState = await sb
      .from('profiles_public')
      .select('id')
      .ilike('state', loc.state)
      .limit(500);
    ids = ((byState.data ?? []) as Array<{ id: string | null }>)
      .map((r) => r.id)
      .filter((id): id is string => !!id);
  }
  return ids;
}
