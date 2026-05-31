// chat-users.ts — busca de usuários pro modal "Nova conversa".

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';
import { isProfessionalRole, type UserMini } from './chat-types';

// Min length pra busca (vanilla: `query.trim().length < 2` → vazio).
const SEARCH_MIN_QUERY_LENGTH = 2;

/**
 * Busca usuários por nome/tag pro modal "Nova conversa".
 *
 * Validações:
 *  - Query trim < 2 chars → [] (não bate na rede). Vanilla usava < 2 também.
 *  - Exclui IDs em excludeIds (normalmente: o próprio user + quem já tem
 *    conversa ativa pra evitar duplicação).
 *
 * Estratégia: pega top 200 de profiles_public e filtra no client (mesma
 * lógica do vanilla — RPC não existe ainda; full-text search seria upgrade
 * futuro). Caller faz debounce do textbox via useSearchUsers hook.
 */
export async function searchUsers(
  query: string,
  excludeIds: string[] = [],
): Promise<UserMini[]> {
  const q = (query ?? '').replace('@', '').trim().toLowerCase();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];

  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles_public')
    .select('id, name, tag, avatar_url, role, user_type')
    .limit(200);
  if (error) throw new NetworkError(error.message, error);

  const excludeSet = new Set(excludeIds);
  const filtered: UserMini[] = [];
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(raw.id ?? '');
    if (!id || excludeSet.has(id)) continue;
    const name = String(raw.name ?? '');
    const tag = (raw.tag as string | null) ?? null;
    const n = name.toLowerCase();
    const t = (tag ?? '').toLowerCase();
    if (!n.includes(q) && !t.includes(q)) continue;
    const role =
      (raw.role as string | null) ?? (raw.user_type as string | null) ?? null;
    filtered.push({
      id,
      name: name || null,
      tag,
      avatarUrl: (raw.avatar_url as string | null) ?? null,
      role,
      isProfessional: isProfessionalRole(role),
    });
  }
  return filtered;
}
