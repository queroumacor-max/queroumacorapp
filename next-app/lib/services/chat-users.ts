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
 * Estratégia: filtra no SERVIDOR via ILIKE em name + tag (BUG39). Antes
 * pegávamos só os primeiros 200 de profiles_public (sem ordenação nem
 * filtro) e casávamos no client — com milhares de perfis, o usuário
 * procurado quase nunca estava nesse recorte arbitrário, então a busca
 * "não encontrava ninguém". Agora o Postgres faz o match de substring
 * (case-insensitive) sobre a tabela toda e devolve só os relevantes.
 * Caller faz debounce do textbox via useSearchUsers hook.
 */
export async function searchUsers(
  query: string,
  excludeIds: string[] = [],
  options?: { signal?: AbortSignal },
): Promise<UserMini[]> {
  // Remove @ inicial e caracteres que quebram a sintaxe do filtro `or` do
  // PostgREST (vírgula separa condições, parênteses agrupam) e os curingas
  // do ILIKE (% e _). ILIKE já é case-insensitive, mas mantemos lowercase.
  const q = (query ?? '')
    .replace('@', '')
    .replace(/[,()%_*\\]/g, ' ')
    .trim()
    .toLowerCase();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];

  const sb = getSupabase();
  const pattern = `%${q}%`;
  const builder = sb
    .from('profiles_public')
    .select('id, name, tag, avatar_url, role, user_type')
    .or(`name.ilike.${pattern},tag.ilike.${pattern}`)
    .limit(50);
  const builderFinal = options?.signal
    ? (builder as unknown as { abortSignal: (s: AbortSignal) => typeof builder }).abortSignal(options.signal)
    : builder;
  const { data, error } = await builderFinal;
  if (error) throw new NetworkError(error.message, error);

  const excludeSet = new Set(excludeIds);
  const filtered: UserMini[] = [];
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(raw.id ?? '');
    if (!id || excludeSet.has(id)) continue;
    const name = String(raw.name ?? '');
    const tag = (raw.tag as string | null) ?? null;
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
