// blocks — service de bloqueio de usuário (S6). Tabela `blocks` tem RLS
// owner-only; aqui só envelopamos as chamadas. RPC `list_blocked_ids()`
// devolve uuid[] do user logado pra cliente filtrar feed/notif sem N+1.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';

export interface BlockedRow {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
  blocked?: { id: string; name?: string | null; tag?: string | null; avatar_url?: string | null } | null;
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (!blockerId || !blockedId) throw new ValidationError('IDs obrigatórios');
  if (blockerId === blockedId) throw new ValidationError('Não pode bloquear a si mesmo');
  const sb = getSupabase();
  const { error } = await sb
    .from('blocks' as never)
    .insert({ blocker_id: blockerId, blocked_id: blockedId } as never);
  if (error) {
    // duplicate_key (já bloqueado) é no-op desejado.
    if (/duplicate key/i.test(error.message)) return;
    throw new NetworkError(error.message || 'Falha ao bloquear', error);
  }
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  if (!blockerId || !blockedId) throw new ValidationError('IDs obrigatórios');
  const sb = getSupabase();
  const { error } = await sb
    .from('blocks' as never)
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw new NetworkError(error.message || 'Falha ao desbloquear', error);
}

export async function listBlocked(blockerId: string): Promise<BlockedRow[]> {
  if (!blockerId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('blocks' as never)
    .select('id, blocker_id, blocked_id, created_at')
    .eq('blocker_id', blockerId)
    .order('created_at', { ascending: false });
  if (error) throw new NetworkError(error.message || 'Falha ao listar bloqueados', error);
  const rows = (data ?? []) as Array<{
    id: string; blocker_id: string; blocked_id: string; created_at: string;
  }>;
  if (rows.length === 0) return [];

  // Enriquecer com profile do blocked.
  const ids = rows.map((r) => r.blocked_id);
  const { data: profs } = await sb
    .from('profiles_public')
    .select('id, name, tag, avatar_url')
    .in('id', ids);
  const profMap = new Map<string, { id: string; name?: string | null; tag?: string | null; avatar_url?: string | null }>();
  for (const p of profs ?? []) {
    const row = p as { id: string; name?: string | null; tag?: string | null; avatar_url?: string | null };
    profMap.set(row.id, row);
  }
  return rows.map((r) => ({ ...r, blocked: profMap.get(r.blocked_id) ?? null }));
}

/** Devolve uuid[] dos blocked do user logado (via RPC list_blocked_ids). */
export async function listBlockedIds(): Promise<string[]> {
  const sb = getSupabase();
  const rpcAny = sb.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpcAny('list_blocked_ids');
  if (error) return []; // degradação graciosa: prefere não filtrar a quebrar
  return Array.isArray(data) ? (data as string[]) : [];
}
