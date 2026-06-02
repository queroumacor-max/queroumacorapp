// useNotes — hook React pra feature "Anotações" (dashboard sidebar). Casa
// o service notes.ts com TanStack Query: lista (useQuery), criar, soft
// delete (com undo), undo.
//
// Padrão de uso:
//   const { notes, save, remove, undoRemove, isSaving, isDeleting } = useNotes();
//   <NoteItem onDelete={(id) => remove(id)} />  // depois mostrar UndoSnackbar
//                                                  e passar undoRemove no botão
//
// NÃO usa otimismo nas mutations — anotações são raras o suficiente que
// um refetch após cada operação cobre. Otimismo pode entrar quando o
// volume justificar.

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  listNotes,
  saveNote as saveNoteSvc,
  updateNote as updateNoteSvc,
  softDeleteNote as softDeleteNoteSvc,
  undoDeleteNote as undoDeleteNoteSvc,
  type Note,
} from '@/lib/services/notes';
import type { SoftDeleteResult } from '@/lib/services/postInteractions';

export interface UseNotesResult {
  notes: Note[];
  loading: boolean;
  error: Error | null;
  save: (body: string) => Promise<Note>;
  update: (args: { noteId: string; body: string }) => Promise<void>;
  remove: (noteId: string) => Promise<SoftDeleteResult>;
  undoRemove: (noteId: string) => Promise<void>;
  isSaving: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  isUndoing: boolean;
}

export function useNotes(): UseNotesResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';
  const key = ['notes', userId];

  const query = useQuery<Note[], Error>({
    queryKey: key,
    queryFn: () => listNotes(userId),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const saveMut = useMutation<Note, Error, string>({
    mutationFn: (body: string) => saveNoteSvc(userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const updateMut = useMutation<void, Error, { noteId: string; body: string }>({
    mutationFn: ({ noteId, body }) => updateNoteSvc(noteId, userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const removeMut = useMutation<SoftDeleteResult, Error, string>({
    mutationFn: (noteId: string) => softDeleteNoteSvc(noteId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const undoMut = useMutation<void, Error, string>({
    mutationFn: (noteId: string) => undoDeleteNoteSvc(noteId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return {
    notes: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    save: saveMut.mutateAsync,
    update: updateMut.mutateAsync,
    remove: removeMut.mutateAsync,
    undoRemove: undoMut.mutateAsync,
    isSaving: saveMut.isPending,
    isUpdating: updateMut.isPending,
    isDeleting: removeMut.isPending,
    isUndoing: undoMut.isPending,
  };
}
