// trending — RPC `get_trending_posts(p_limit, p_window_days)`. Janela
// default 7 dias, score = likes + 3*comments. Servidor exclui blocked.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export interface TrendingPost {
  id: string;
  user_id: string;
  caption: string | null;
  media_url: string | null;
  media_type: string | null;
  media_width: number | null;
  media_height: number | null;
  created_at: string;
  score: number;
}

export async function fetchTrendingPosts(
  limit = 30,
  windowDays = 7,
): Promise<TrendingPost[]> {
  const sb = getSupabase();
  const rpcAny = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpcAny('get_trending_posts', {
    p_limit: limit,
    p_window_days: windowDays,
  });
  if (error) throw new NetworkError(error.message || 'Falha ao buscar trending', error);
  return Array.isArray(data) ? (data as TrendingPost[]) : [];
}
