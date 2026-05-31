// useSearch — hook React pra busca full-text com debounce.
// Wrap em torno de searchAll() + TanStack Query + debounce no caller.
//
// Pattern (alinhado com useTagAvailability + useSearchUsers de useChat.ts):
//   - debounce 300ms via useEffect + setTimeout (sem util externa pra
//     manter o hook auto-contido);
//   - debounced query vai pra queryKey → TanStack faz cache automático,
//     então digitar/apagar/digitar a mesma coisa NÃO bate na rede de novo;
//   - staleTime 60s pra que navegar até /search/[outra-busca] e voltar pra
//     mesma busca não dispare refetch desnecessário.
//
// Caller passa o `query` cru (vindo do input.value); o debounce vive aqui
// pra que cada `<SearchInput>` não precise reimplementar setTimeout.

'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchAll, type SearchResult } from '@/lib/services/search';

export interface UseSearchResult {
  results: SearchResult[];
  loading: boolean;
  error: Error | null;
  // Query usada de fato (após debounce) — útil pra mostrar "buscando por X".
  debouncedQuery: string;
}

const DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 20;

export function useSearch(query: string, limit = SEARCH_LIMIT): UseSearchResult {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    // Trim aqui pra que " palavra " e "palavra" gerem a mesma queryKey;
    // searchAll também trima, mas pré-normalizar antes da queryKey evita
    // entradas duplicadas no cache do TanStack.
    const trimmed = query.trim();
    const id = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const result = useQuery<SearchResult[], Error>({
    queryKey: ['search', debouncedQuery, limit],
    queryFn: () => searchAll(debouncedQuery, limit),
    // Não dispara se < 2 chars — o service também filtra, mas evitar a
    // promise em vão deixa o `loading` mais honesto (não pisca true→false
    // pra uma query trivialmente vazia).
    enabled: debouncedQuery.length >= 2,
    staleTime: 60_000,
  });

  return {
    results: result.data ?? [],
    // fetchStatus !== 'idle' evita `loading=true` quando enabled=false (o
    // TanStack mantém isLoading=true se nunca rodou). Pattern de useSearchUsers.
    loading: result.isLoading && result.fetchStatus !== 'idle',
    error: result.error ?? null,
    debouncedQuery,
  };
}
