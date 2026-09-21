// useStores — catálogo de lojas do StoreSelector. Cache longo: a lista só
// muda quando a loja cadastra/edita uma loja pelo portal, o que é raro.

'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchStores, type Store } from '@/lib/services/stores';

export function useStores() {
  const q = useQuery<Store[], Error>({
    queryKey: ['stores'],
    queryFn: fetchStores,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    stores: q.data ?? [],
    loading: q.isLoading,
    error: q.error ?? null,
  };
}
