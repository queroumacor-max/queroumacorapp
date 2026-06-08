// suggestedProfiles.ts — lista de "pessoas que você pode seguir".
// Replica o que o vanilla mostra na tela de busca quando o input está
// vazio (modules/feed.js / explore + sugestões). Filtros:
//   1. exclui o próprio user;
//   2. exclui quem o user já segue (puxa de `follows` primeiro);
//   3. nome não-vazio (perfil mínimo preenchido);
//   4. ordena pelos mais recentes;
//   5. limita a `limit` (default 50).

import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export async function fetchSuggestedProfiles(
  excludeUserId: string | null,
  limit = 50
): Promise<Profile[]> {
  const sb = getSupabase();

  // 1) Carrega quem o user já segue pra excluir das sugestões.
  let followingIds: string[] = [];
  if (excludeUserId) {
    const { data: follows } = await sb
      .from('follows')
      .select('following_id')
      .eq('follower_id', excludeUserId);
    followingIds = (follows ?? [])
      .map((f) => (f as { following_id: string | null }).following_id)
      .filter((id): id is string => !!id);
  }

  // 2) Monta a lista de IDs a excluir (self + already-followed).
  const excludeIds = excludeUserId
    ? [excludeUserId, ...followingIds]
    : followingIds;

  let query = sb
    .from('profiles_public')
    .select('id, name, tag, avatar_url, role, user_type, city, state, is_pro, bio')
    .not('name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (excludeIds.length > 0) {
    // PostgREST: `.not('id', 'in', '(uuid1,uuid2)')` — paren-delimited list.
    query = query.not('id', 'in', `(${excludeIds.join(',')})`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}
