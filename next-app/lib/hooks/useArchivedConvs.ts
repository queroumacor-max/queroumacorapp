// useArchivedConvs — hook React que centraliza leitura/escrita do array de
// conversas arquivadas (`profiles.archived_conversations`) via TanStack Query.
//
// Substitui o estado module-level + funções do vanilla
// (modules/archive.js: archivedConvs + loadArchivedConvs + archiveConversation
// + unarchiveConversation + saveArchivedConvs) por um shape declarativo:
//   - useQuery faz fetch + cache (staleTime 30s — pouco volume mas é
//     conveniente revalidar quando o usuário volta da rota /chat);
//   - useMutation cobre archive/unarchive: o service já é idempotente e faz
//     read-modify-write, então a mutation só dispara e invalida a query.
//
// O hook NÃO tem page própria (archive é consumido pela tela de chat). O
// caller usa `archivedSet` (Set<string>) pra `has()` rápido na renderização
// da lista de conversas.

'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { archive, listArchived, unarchive } from '@/lib/services/archive';

export interface UseArchivedConvsResult {
  archived: string[];
  archivedSet: Set<string>;
  loading: boolean;
  error: Error | null;
  archive: (conversationId: string) => void;
  unarchive: (conversationId: string) => void;
  isMutating: boolean;
  mutationError: Error | null;
}

export function useArchivedConvs(): UseArchivedConvsResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<string[], Error>({
    queryKey: ['archived-convs', user?.id],
    queryFn: () => listArchived(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });

  const archiveMutation = useMutation<string[], Error, string>({
    mutationFn: (conversationId: string) => archive(user!.id, conversationId),
    onSuccess: (next) => {
      // Otimização: já temos o array novo do service — escreve direto no
      // cache pra evitar refetch desnecessário. O invalidate ainda dispara
      // pra qualquer outro consumer que esteja observando.
      qc.setQueryData(['archived-convs', user?.id], next);
    },
  });

  const unarchiveMutation = useMutation<string[], Error, string>({
    mutationFn: (conversationId: string) => unarchive(user!.id, conversationId),
    onSuccess: (next) => {
      qc.setQueryData(['archived-convs', user?.id], next);
    },
  });

  const archived = query.data ?? [];
  // Set<string> derivado pra .has() O(1) — relevante quando a lista de chats
  // tiver centenas de items e cada render iterar pra hide/show.
  const archivedSet = useMemo(() => new Set(archived), [archived]);

  return {
    archived,
    archivedSet,
    loading: query.isLoading,
    error: query.error ?? null,
    archive: archiveMutation.mutate,
    unarchive: unarchiveMutation.mutate,
    isMutating: archiveMutation.isPending || unarchiveMutation.isPending,
    mutationError:
      archiveMutation.error ?? unarchiveMutation.error ?? null,
  };
}
