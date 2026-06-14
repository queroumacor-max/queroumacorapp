// useArtReferences — TanStack Query wrappers da biblioteca de artes do
// pintor/grafiteiro. Reflete listMy/upload/delete do service.

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  listMyArtReferences,
  uploadArtReference,
  deleteArtReference,
  type ArtReference,
} from '@/lib/services/artReferences';

interface UploadArg {
  file: File;
  title?: string | null;
  tags?: string[];
  dimensions?: { width: number; height: number } | null;
}

export function useArtReferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';

  const list = useQuery<ArtReference[], Error>({
    queryKey: ['art-references', userId],
    queryFn: () => listMyArtReferences(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['art-references', userId] });

  const uploadMut = useMutation<ArtReference, Error, UploadArg>({
    mutationFn: (arg) => uploadArtReference({ userId, ...arg }),
    onSuccess: (created) => {
      // Insere a arte recém-criada direto no cache (lista é desc por
      // created_at → prepend). Antes só invalidava e dependia do refetch;
      // quando o refetch não trazia a row na hora, o "Arte salva" aparecia
      // mas o card não. Prepend garante que aparece já. invalidate com
      // refetchType:'none' marca stale sem refetch imediato (não clobbera
      // o otimista); reconcilia no próximo acesso natural.
      qc.setQueryData<ArtReference[]>(['art-references', userId], (old) => {
        const rest = (old ?? []).filter((a) => a.id !== created.id);
        return [created, ...rest];
      });
      qc.invalidateQueries({ queryKey: ['art-references', userId], refetchType: 'none' });
    },
  });

  const deleteMut = useMutation<void, Error, ArtReference>({
    mutationFn: (ref) => deleteArtReference(ref),
    onSuccess: (_void, ref) => {
      // Remove do cache na hora + invalida pra confirmar com o banco.
      qc.setQueryData<ArtReference[]>(['art-references', userId], (old) =>
        (old ?? []).filter((a) => a.id !== ref.id),
      );
      invalidate();
    },
  });

  return {
    items: list.data ?? [],
    loading: list.isLoading,
    error: list.error ?? null,
    upload: uploadMut.mutateAsync,
    isUploading: uploadMut.isPending,
    uploadError: uploadMut.error ?? null,
    remove: deleteMut.mutateAsync,
    isDeleting: deleteMut.isPending,
  };
}
