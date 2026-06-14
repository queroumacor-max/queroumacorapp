// useColorMatch — carrega (e cacheia) o catálogo de cores da loja uma vez e
// expõe `nearest(hex)` pra cruzar uma cor-alvo com as tintas disponíveis.
// O catálogo não muda a cada toque do eyedropper, então fica em cache longo.

'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchColorCatalog,
  nearestColors,
  type ColorCatalogItem,
  type ColorMatch,
} from '@/lib/services/colorMatch';

export function useColorMatch() {
  const catalog = useQuery<ColorCatalogItem[], Error>({
    queryKey: ['color-catalog'],
    queryFn: fetchColorCatalog,
    staleTime: 30 * 60_000, // 30 min — catálogo de cor é estável
    gcTime: 60 * 60_000,
  });

  const nearest = useCallback(
    (hex: string, limit = 12): ColorMatch[] =>
      catalog.data ? nearestColors(hex, catalog.data, limit) : [],
    [catalog.data],
  );

  return {
    nearest,
    ready: !!catalog.data,
    loading: catalog.isLoading,
    error: catalog.error ?? null,
    count: catalog.data?.length ?? 0,
  };
}
