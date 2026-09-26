// connections.ts — listas de "seguidores" e "seguindo" de um perfil,
// com os dados que a tela precisa mostrar (foto, nome, @tag) e o estado
// do relacionamento com QUEM está olhando (pra decidir entre "Seguir",
// "Seguindo" e "Mensagem", como no Instagram).
//
// Query em 2 passos (ids em `follows` → perfis em `profiles_public`) em
// vez de embed do PostgREST: `follows` não tem FK declarada pra
// `profiles_public` (é view), então o embed falharia. Mesmo padrão já
// usado em Pedidos da Loja e na galeria de logos do portal.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export type ConnectionTab = 'seguidores' | 'seguindo';

export interface ConnectionProfile {
  id: string;
  name: string | null;
  tag: string | null;
  avatarUrl: string | null;
  role: string | null;
  city: string | null;
  /** O viewer segue esta pessoa? Move o botão entre Seguir/Seguindo. */
  followedByViewer: boolean;
  /** É o próprio viewer? Não mostra botão de ação. */
  isViewer: boolean;
}

const PAGE_SIZE = 200;

/**
 * Lista os perfis de uma aba. `profileId` é o dono da lista; `viewerId` é
 * quem está olhando (pode ser null/anônimo — aí nenhum botão de seguir).
 */
export async function fetchConnections(args: {
  profileId: string;
  tab: ConnectionTab;
  viewerId: string | null;
}): Promise<ConnectionProfile[]> {
  const { profileId, tab, viewerId } = args;
  if (!profileId) return [];
  const sb = getSupabase();

  // 1) IDs do lado certo da relação.
  const idColumn = tab === 'seguidores' ? 'follower_id' : 'following_id';
  const matchColumn = tab === 'seguidores' ? 'following_id' : 'follower_id';
  const { data: rows, error } = await sb
    .from('follows')
    .select(idColumn)
    .eq(matchColumn, profileId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw new NetworkError(error.message, error);

  const ids = ((rows ?? []) as Array<Record<string, unknown>>)
    .map((r) => r[idColumn])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (ids.length === 0) return [];

  // 2) Perfis + (3) quem o viewer já segue, em paralelo.
  const [profilesRes, viewerFollowingRes] = await Promise.all([
    sb
      .from('profiles_public')
      .select('id, name, tag, avatar_url, role, city')
      .in('id', ids),
    viewerId
      ? sb.from('follows').select('following_id').eq('follower_id', viewerId).in('following_id', ids)
      : Promise.resolve({ data: [] as Array<{ following_id: string | null }> }),
  ]);

  const followedSet = new Set(
    ((viewerFollowingRes.data ?? []) as Array<{ following_id: string | null }>)
      .map((r) => r.following_id)
      .filter((v): v is string => !!v),
  );

  const byId = new Map<string, Record<string, unknown>>();
  for (const p of (profilesRes.data ?? []) as Array<Record<string, unknown>>) {
    byId.set(String(p.id), p);
  }

  // Preserva a ordem de `follows` (mais recentes primeiro) — o `in()` do
  // PostgREST não garante a ordem dos ids que mandamos.
  return ids
    .map((id) => {
      const p = byId.get(id);
      if (!p) return null; // perfil apagado — some da lista
      return {
        id,
        name: (p.name as string | null) ?? null,
        tag: (p.tag as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
        role: (p.role as string | null) ?? null,
        city: (p.city as string | null) ?? null,
        followedByViewer: followedSet.has(id),
        isViewer: !!viewerId && id === viewerId,
      } satisfies ConnectionProfile;
    })
    .filter((v): v is ConnectionProfile => v !== null);
}

/** Filtro local por nome ou @tag — a lista já vem inteira do servidor. */
export function filterConnections(
  list: ConnectionProfile[],
  query: string,
): ConnectionProfile[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (p) =>
      (p.name || '').toLowerCase().includes(q) || (p.tag || '').toLowerCase().includes(q),
  );
}
