// useQualifications — hook React que centraliza leitura/escrita da tabela
// `qualifications` (formações do usuário) via TanStack Query.
//
// Substitui o trio vanilla (modules/quals-courses.js: loadQualsList +
// addQualification + deleteQualification) por um state management
// declarativo:
//   - useQuery faz cache + revalidação (staleTime de 60s — formações não
//     mudam com frequência);
//   - useMutation cobre add/delete com invalidação automática da query
//     (a lista re-renderiza com a row nova/menos sem refetch manual);
//   - hook fica enabled só com `user` presente — usa a mesma proteção dos
//     demais (useNotifications/usePedidos) pra não bater no banco deslogado.

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  addQual,
  deleteQual,
  listQuals,
  updateQual,
  type AddQualInput,
  type UpdateQualInput,
  type Qualification,
} from '@/lib/services/formacao';

export interface UseQualificationsResult {
  qualifications: Qualification[];
  loading: boolean;
  error: Error | null;
  add: (input: AddQualInput) => void;
  update: (args: { qualId: string; input: UpdateQualInput }) => void;
  remove: (qualId: string) => void;
  isAdding: boolean;
  isUpdating: boolean;
  isRemoving: boolean;
  addError: Error | null;
  updateError: Error | null;
  removeError: Error | null;
}

export function useQualifications(): UseQualificationsResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<Qualification[], Error>({
    queryKey: ['qualifications', user?.id],
    queryFn: () => listQuals(user!.id),
    enabled: !!user,
    staleTime: 60_000,
    refetchOnMount: 'always',
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['qualifications', user?.id] });

  const addMutation = useMutation<Qualification, Error, AddQualInput>({
    mutationFn: (input: AddQualInput) => addQual(user!.id, input),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation<
    Qualification,
    Error,
    { qualId: string; input: UpdateQualInput }
  >({
    mutationFn: ({ qualId, input }) => updateQual(user!.id, qualId, input),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation<void, Error, string>({
    mutationFn: (qualId: string) => deleteQual(user!.id, qualId),
    onSuccess: invalidate,
  });

  return {
    qualifications: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    add: addMutation.mutate,
    update: updateMutation.mutate,
    remove: removeMutation.mutate,
    isAdding: addMutation.isPending,
    isUpdating: updateMutation.isPending,
    isRemoving: removeMutation.isPending,
    addError: addMutation.error ?? null,
    updateError: updateMutation.error ?? null,
    removeError: removeMutation.error ?? null,
  };
}
