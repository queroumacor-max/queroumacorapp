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
    onSuccess: invalidate,
  });

  const deleteMut = useMutation<void, Error, ArtReference>({
    mutationFn: (ref) => deleteArtReference(ref),
    onSuccess: invalidate,
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
