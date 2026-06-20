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

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchProduct,
  fetchProducts,
  groupProductsByName,
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
  // `search` reflete o input em tempo real (digitação fluida). `debouncedSearch`
  // é o valor que efetivamente filtra os ~4k produtos — atrasado 250ms pra não
  // refiltrar + re-renderizar a lista inteira a cada tecla (era a maior fonte
  // de "trava ao digitar" reportada).
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = useQuery<Product[], Error>({
    queryKey: ['products'],
    // Sem limit explícito — fetchProducts pagina via range em batches de
    // 1000 até pegar todos os ~4000+ produtos do catálogo (PostgREST cap
    // de 1000 por request, então um único .limit(5000) não basta).
    queryFn: ({ signal }) => fetchProducts({ signal }),
    staleTime: MKT_TTL,
  });

  // Agrupa produtos com mesmo nome base (diferindo só pelo sufixo de tamanho).
  const all = useMemo(() => groupProductsByName(query.data ?? []), [query.data]);

  // Agrupa por categoria. Usado pra mostrar contadores no menu (X tintas,
  // Y texturas etc.). useMemo evita recálculo quando search muda mas a
  // base não — relevante porque o agrupamento percorre todos os items.
  const byCategory = useMemo<Record<string, Product[]>>(() => {
    const groups: Record<string, Product[]> = {};
    // Produtos de uso misto que aparecem em tintas imob. E tintas automotivas.
    const dupAutoCode = new Set(['1593']);
    for (const p of all) {
      const k = mktClassify(p);
      (groups[k] = groups[k] || []).push(p);
      if (k === 'tintas' && (
        (p.name || '').toLowerCase().includes('wash primer') ||
        dupAutoCode.has(String(p.code || '').trim())
      )) {
        (groups['tintas_auto'] = groups['tintas_auto'] || []).push(p);
      }
    }
    return groups;
  }, [all]);

  const filtered = useMemo(() => {
    let rows = all;
    if (category !== 'todos') {
      rows = byCategory[category] ?? [];
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          (p.name || '').toLowerCase().includes(q) ||
          String(p.code || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [all, byCategory, category, debouncedSearch]);

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
