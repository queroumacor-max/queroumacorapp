// suggestions — sugestões de "quem seguir" via RPC suggest_to_follow.
// Ordenação (no SQL): mesma cidade > mesma UF > rating_avg > review_count.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export interface SuggestionRow {
  id: string;
  name: string | null;
  tag: string | null;
  avatar_url: string | null;
  role: string | null;
  city: string | null;
  state: string | null;
  rating_avg: number | null;
  review_count: number | null;
  is_pro: boolean | null;
  verified: boolean | null;
}

export async function fetchSuggestions(limit = 10): Promise<SuggestionRow[]> {
  const sb = getSupabase();
  const rpcAny = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpcAny('suggest_to_follow', { p_limit: limit });
  if (error) throw new NetworkError(error.message || 'Falha ao buscar sugestões', error);
  return Array.isArray(data) ? (data as SuggestionRow[]) : [];
}
