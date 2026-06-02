// suggestedProfiles.ts — lista de "pessoas que você pode seguir".
// Replica o que o vanilla mostra na tela de busca quando o input está
// vazio (modules/feed.js / explore + sugestões). Aqui prioriza:
//   1. perfis verificados (role pintor/grafiteiro/automotivo);
//   2. quem tem avatar + nome preenchido (perfil "completo");
//   3. exclui o próprio user;
//   4. limita a 50 sugestões.

import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export async function fetchSuggestedProfiles(
  excludeUserId: string | null,
  limit = 50
): Promise<Profile[]> {
  const sb = getSupabase();
  // profiles_public é a view safe (sem email/dados sensíveis). Filtros:
  //   - role em pintor/grafiteiro/automotivo OU user_type semelhante
  //   - name não-vazio
  //   - exclui o caller (se houver)
  let query = sb
    .from('profiles_public')
    .select('id, name, tag, avatar_url, role, user_type, city, state, is_pro, bio')
    .not('name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (excludeUserId) {
    query = query.neq('id', excludeUserId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}
