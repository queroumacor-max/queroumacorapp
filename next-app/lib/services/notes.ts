// notes.ts — service layer pra feature "Anotações" (campo `notes` na barra
// lateral do dashboard, espelha modules/notes.js do vanilla). Subset
// portado: list/save/softDelete/undoDelete. Update inline fica como
// follow-up se virar requisito.
//
// Schema relevante (supabase_init.sql + 2026-05-31-soft-delete.sql):
//   - notes: id, user_id, body, created_at, deleted_at
//   - RLS: dono lê próprias (incluindo soft-deleted, pra desfazer); admin
//     vê tudo. INSERT/UPDATE/DELETE restritos ao dono.
//
// Convenções:
//   - softDeleteNote retorna { undoToken } (id da row) pra o hook
//     popular a UndoSnackbar com um identificador opaco.
//   - undoDeleteNote é idempotente — chamar 2x não estoura.
//   - listNotes filtra deleted_at IS NULL no client (defesa em
//     profundidade — a RLS no banco já restringe ao dono, mas queremos
//     também esconder rows soft-deleted do dono na UI normal).

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import type { SoftDeleteResult } from './postInteractions';

export interface Note {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
}

// ─── LIST ──────────────────────────────────────────────────────────────────

/**
 * Lista as anotações ativas (deleted_at IS NULL) do usuário, mais recentes
 * primeiro. RLS já restringe ao dono — userId aqui é só pra short-circuit
 * sem rede quando o caller ainda está sem auth.
 */
export async function listNotes(userId: string): Promise<Note[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('notes')
    .select('id, user_id, body, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new NetworkError(error.message, error);
  return ((data ?? []) as Array<{
    id: string;
    user_id: string | null;
    body: string | null;
    created_at: string | null;
  }>).map((r) => ({
    id: r.id,
    user_id: r.user_id ?? '',
    body: r.body ?? '',
    created_at: r.created_at ?? '',
  }));
}

// ─── CREATE ────────────────────────────────────────────────────────────────

/**
 * Insere uma nova anotação. Trim defensivo no body — UI já valida em
 * button-disabled mas guard cobre callers programáticos. Retorna a row
 * inserida pra hook poder dar paint instantâneo sem refetch.
 */
export async function saveNote(
  userId: string,
  body: string,
): Promise<Note> {
  if (!userId) throw new ValidationError('userId obrigatório');
  const trimmed = (body || '').trim();
  if (!trimmed) throw new ValidationError('Anotação vazia');

  const sb = getSupabase();
  const { data, error } = await sb
    .from('notes')
    .insert({ user_id: userId, body: trimmed })
    .select('id, user_id, body, created_at')
    .single();
  if (error) throw new NetworkError(error.message, error);
  if (!data) throw new NetworkError('Anotação não retornada');
  const row = data as {
    id: string;
    user_id: string | null;
    body: string | null;
    created_at: string | null;
  };
  return {
    id: row.id,
    user_id: row.user_id ?? userId,
    body: row.body ?? trimmed,
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

// ─── SOFT DELETE + UNDO ────────────────────────────────────────────────────

/**
 * Soft delete: marca `deleted_at = now()`. Retorna o undoToken (id da row)
 * pra UI passar pra UndoSnackbar.
 */
export async function softDeleteNote(
  noteId: string,
  userId: string,
): Promise<SoftDeleteResult> {
  if (!noteId) throw new ValidationError('noteId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', noteId)
    .eq('user_id', userId);
  if (error) throw new NetworkError(error.message, error);
  return { undoToken: noteId };
}

/**
 * Reverte soft delete (chama UPDATE com deleted_at = null). Idempotente.
 */
export async function undoDeleteNote(
  noteId: string,
  userId: string,
): Promise<void> {
  if (!noteId) throw new ValidationError('noteId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('notes')
    .update({ deleted_at: null })
    .eq('id', noteId)
    .eq('user_id', userId);
  if (error) throw new NetworkError(error.message, error);
}
