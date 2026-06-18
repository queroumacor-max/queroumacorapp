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
  // `.bind(sb)`: preserva o `this` do client (sb.rpc solto estoura em this.rest).
  const rpcAny = (sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>).bind(sb);
  const { data, error } = await rpcAny('get_trending_posts', {
    p_limit: limit,
    p_window_days: windowDays,
  });
  if (!error) {
    return Array.isArray(data) ? (data as TrendingPost[]) : [];
  }
  // Fallback: se a RPC falhar (função ausente/erro no servidor), em vez de
  // deixar a /explore travada em skeleton/erro, mostra os posts mais RECENTES
  // com mídia da janela. score=0 (sem ranking real), mas a tela funciona —
  // mesma filosofia do fallback do feed.
  try {
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const { data: posts, error: fbErr } = await sb
      .from('posts')
      .select(
        'id, user_id, caption, media_url, media_type, media_width, media_height, created_at',
      )
      .or('status.eq.approved,status.is.null')
      .is('deleted_at', null)
      .not('media_url', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fbErr) throw fbErr;
    return (posts ?? []).map(
      (p) => ({ ...(p as Record<string, unknown>), score: 0 } as unknown as TrendingPost),
    );
  } catch {
    throw new NetworkError(error.message || 'Falha ao buscar trending', error);
  }
}
