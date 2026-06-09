// boost — service de "Destacar post" (S11). RPCs `boost_post` e
// `unboost_post` no servidor validam ownership + PRO. Aqui só envelope.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export async function boostPost(postId: string, days = 7): Promise<void> {
  const sb = getSupabase();
  const rpcAny = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpcAny('boost_post', { p_post_id: postId, p_days: days });
  if (error) throw new NetworkError(error.message || 'Falha ao destacar post', error);
}

export async function unboostPost(postId: string): Promise<void> {
  const sb = getSupabase();
  const rpcAny = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpcAny('unboost_post', { p_post_id: postId });
  if (error) throw new NetworkError(error.message || 'Falha ao remover destaque', error);
}
