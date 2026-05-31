// archive.ts — service layer pra "conversas arquivadas". Persiste em
// `profiles.archived_conversations` (text[]) — mesma coluna usada pelo
// vanilla em modules/archive.js (loadArchivedConvs / saveArchivedConvs).
//
// Diferenças de design vs vanilla:
//   - vanilla mantém `archivedConvs` em memória module-level e dispara
//     update no banco a cada toggle; aqui mantemos só funções stateless
//     (list/archive/unarchive) e deixamos o estado vivo no hook
//     (useArchivedConvs via TanStack Query);
//   - archive/unarchive fazem read-modify-write de array em vez de tentar
//     usar `array_append`/`array_remove` no Postgres — `text[]` em jsonb-like
//     uso (lista pequena de IDs) não justifica a complexidade do array op,
//     e o cache do TanStack Query já segura race conditions práticas.
//
// Race condition residual: dois clientes editando o array em paralelo podem
// um sobrescrever a alteração do outro. Pra essa feature (conversas
// arquivadas do próprio usuário, raro multi-dispositivo simultâneo) é
// aceitável; se virar requisito, mover pra RPC com `array_append`/RLS.

import { getSupabase } from '@/lib/supabase';
import { ValidationError, NetworkError } from '@/lib/errors';

/**
 * Lê o array de conversas arquivadas do perfil. Retorna [] se userId vazio
 * ou se o perfil ainda não tem nenhuma arquivada (coluna pode ser null pra
 * usuários antigos pré-feature).
 */
export async function listArchived(userId: string): Promise<string[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('archived_conversations')
    .eq('id', userId)
    .single();
  if (error) {
    throw new NetworkError(error.message, error);
  }
  // `archived_conversations` é text[] no banco. supabase-js devolve como
  // string[] | null. Defensivo: filtra valores não-string pra blindar
  // contra dados corrompidos (ex.: migração antiga que gravou number).
  const raw = (data as { archived_conversations?: unknown } | null)
    ?.archived_conversations;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

/**
 * Adiciona uma conversa ao array arquivado. Idempotente: se já estiver
 * arquivada, não duplica nem dispara update no banco. Retorna o novo array
 * pra que o caller atualize o cache local sem refetch.
 */
export async function archive(
  userId: string,
  conversationId: string
): Promise<string[]> {
  if (!userId) throw new ValidationError('Faça login.');
  if (!conversationId) throw new ValidationError('Conversa inválida.');

  const current = await listArchived(userId);
  if (current.includes(conversationId)) return current;

  const next = [...current, conversationId];
  await writeArchived(userId, next);
  return next;
}

/**
 * Remove uma conversa do array arquivado. Idempotente: se não estiver
 * arquivada, no-op (não dispara update). Retorna o novo array.
 */
export async function unarchive(
  userId: string,
  conversationId: string
): Promise<string[]> {
  if (!userId) throw new ValidationError('Faça login.');
  if (!conversationId) throw new ValidationError('Conversa inválida.');

  const current = await listArchived(userId);
  if (!current.includes(conversationId)) return current;

  const next = current.filter((id) => id !== conversationId);
  await writeArchived(userId, next);
  return next;
}

// Helper privado: grava o array novo no perfil. RLS de UPDATE em `profiles`
// já restringe ao dono (`auth.uid() = id`), mas passamos o `.eq('id',userId)`
// como defesa em profundidade (mesma estratégia do deleteQual/deleteCourse).
async function writeArchived(
  userId: string,
  next: string[]
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from('profiles')
    .update({ archived_conversations: next })
    .eq('id', userId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}
