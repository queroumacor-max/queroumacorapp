// useProducts — hook React pra listagem do catálogo. Espelha o vanilla
// `loadMktProducts` + `mktTab` + `mktSearch` num único hook com state.
//
// Design:
//   - useQuery faz fetch único de TODOS os produtos (filter aplicado em
//     memória) — mesma estratégia do vanilla; catálogo tem ~300 itens, não
//     justifica round-trips por filtro. staleTime 5min bate com o
//     `_MKT_TTL` vanilla.
//   - useState pra categoria + busca; useMemo pra derivar a lista filtrada
//     (re-render só quando filter ou data muda).
//   - `useProduct(id)` é um hook irmão (mesma queryKey base) pra a página
//     de detalhe — aproveita o cache do useProducts quando já carregado.

'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchProduct,
  fetchProducts,
  mktClassify,
  type MktCategory,
  type Product,
} from '@/lib/services/mkt';

export type ProductCategoryFilter = MktCategory | 'todos';

export interface UseProductsResult {
  all: Product[];
  filtered: Product[];
  byCategory: Record<string, Product[]>;
  loading: boolean;
  error: Error | null;
  category: ProductCategoryFilter;
  setCategory: (c: ProductCategoryFilter) => void;
  search: string;
  setSearch: (s: string) => void;
}

const MKT_TTL = 5 * 60 * 1000;

export function useProducts(): UseProductsResult {
  const [category, setCategory] = useState<ProductCategoryFilter>('todos');
  const [search, setSearch] = useState('');

  const query = useQuery<Product[], Error>({
    queryKey: ['products'],
    queryFn: ({ signal }) => fetchProducts({ limit: 1000, signal }),
    staleTime: MKT_TTL,
  });

  const all = query.data ?? [];

  // Agrupa por categoria. Usado pra mostrar contadores no menu (X tintas,
  // Y texturas etc.). useMemo evita recálculo quando search muda mas a
  // base não — relevante porque o agrupamento percorre todos os items.
  const byCategory = useMemo<Record<string, Product[]>>(() => {
    const groups: Record<string, Product[]> = {};
    for (const p of all) {
      const k = mktClassify(p);
      (groups[k] = groups[k] || []).push(p);
    }
    return groups;
  }, [all]);

  const filtered = useMemo(() => {
    let rows = all;
    if (category !== 'todos') {
      rows = byCategory[category] ?? [];
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          (p.name || '').toLowerCase().includes(q) ||
          String(p.code || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [all, byCategory, category, search]);

  return {
    all,
    filtered,
    byCategory,
    loading: query.isLoading,
    error: query.error ?? null,
    category,
    setCategory,
    search,
    setSearch,
  };
}

export function useProduct(id: string | null | undefined): {
  product: Product | null;
  loading: boolean;
  error: Error | null;
} {
  const query = useQuery<Product | null, Error>({
    queryKey: ['product', id ?? ''],
    queryFn: ({ signal }) => fetchProduct(id ?? '', { signal }),
    enabled: !!id,
    staleTime: MKT_TTL,
  });
  return {
    product: query.data ?? null,
    loading: query.isLoading,
    error: query.error ?? null,
  };
}
