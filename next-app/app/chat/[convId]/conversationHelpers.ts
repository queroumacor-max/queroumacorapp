// conversationHelpers — funções puras compartilhadas entre os componentes
// da conversa. Separado pra manter ChatConversation < 400 linhas e pra
// permitir teste isolado destas helpers em testes futuros.

import { getSupabase } from '@/lib/supabase';
import { is3WayConvId, strip3WayPrefix } from '@/lib/services/chat';

/**
 * Resolve o "outro lado" do chat a partir do convId. Reproduz a heurística
 * do getChatReceiverId vanilla (modules/chat.js linha 367), com a diferença
 * que aqui só temos o convId + myId — não temos chatData/localStorage.
 *
 * - 1:1 (uuidA_uuidB sorted): retorna o UUID != myId.
 * - 3-way ("3way:uuidA_uuidB"): strip prefix, retorna o UUID != myId
 *   (geralmente o pintor; loja recebe via realtime broadcast).
 * - store_calicolors_<myId>: retorna null (caller usa calicolorsUserId
 *   resolvido via hook).
 */
export function resolveOtherIdFromConvId(
  convId: string,
  myId: string,
): string | null {
  if (!convId || !myId) return null;
  if (convId.startsWith('store_calicolors_')) {
    // Loja sem ID resolvido — caller passa o storeId do useCalicolorsId.
    return null;
  }
  const base = is3WayConvId(convId) ? strip3WayPrefix(convId) : convId;
  // Tenta partes UUID-like (contém '-'). Os IDs no convId são sempre 2.
  const parts = base.split('_').filter((p) => p.includes('-'));
  const other = parts.find((id) => id !== myId);
  return other ?? null;
}

/**
 * Carrega perfis públicos pra hidratar nomes/avatars na lista de mensagens.
 * Lookup é parcial — se algum perfil não voltar (deletado), o caller usa
 * fallback "Usuário". Diferente do fetchPublicProfiles do feed, aqui pegamos
 * o subset mínimo (id, name, avatar_url).
 */
export interface ChatProfileMini {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export async function fetchPublicProfilesForChat(
  ids: string[],
): Promise<ChatProfileMini[]> {
  if (!ids || ids.length === 0) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles_public')
    .select('id, name, avatar_url')
    .in('id', ids);
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: (r.name as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
  }));
}
