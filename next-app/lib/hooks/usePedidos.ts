// usePedidos — hook React que faz a leitura da tabela `orders` (compras na
// loja Cali Colors) via TanStack Query e mantém o estado de filtro local.
//
// Substitui o par vanilla (modules/pedidos.js: loadPedidos + filterPedidos)
// por:
//   - useQuery faz fetch + cache (staleTime 60s — pedidos não mudam tão
//     rápido quanto notificações; revalidar a cada minuto é suficiente);
//   - useState pro filtro de status, derivando a lista filtrada via useMemo
//     (em vez do filterPedidos vanilla que mutava `style.display` no DOM
//     direto — aqui o React recomputa naturalmente quando filter muda).
//
// Não tem realtime: orders só mudam quando o webhook do gateway grava status,
// e o usuário tipicamente sai e volta na tela. Se virar requisito futuro,
// dá pra plugar um channel `orders:user_id` igual ao useNotifications.

'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { fetchPedidos } from '@/lib/services/pedidos';
import type { Order, OrderStatus } from '@/lib/types';

export type PedidoFilter = OrderStatus | 'all';

export interface UsePedidosResult {
  pedidos: Order[];
  allPedidos: Order[];
  loading: boolean;
  error: Error | null;
  filter: PedidoFilter;
  setFilter: (f: PedidoFilter) => void;
}

export function usePedidos(): UsePedidosResult {
  const { user } = useAuth();
  const [filter, setFilter] = useState<PedidoFilter>('all');

  // queryKey carrega user.id pra isolar caches entre sessões (consistente
  // com useNotifications). `enabled` desliga a query quando deslogado pra
  // não estourar dentro do fetchPedidos (que tem guarda mas evita ruído).
  const query = useQuery<Order[], Error>({
    queryKey: ['pedidos', user?.id],
    queryFn: () => fetchPedidos(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  // useMemo evita refilter a cada render quando nem `data` nem `filter`
  // mudaram — relevante porque a página pode re-renderizar por mudanças
  // upstream (auth, theme) sem mexer nessa lista.
  const filtered = useMemo(() => {
    const all = query.data ?? [];
    if (filter === 'all') return all;
    return all.filter((o) => o.status === filter);
  }, [query.data, filter]);

  return {
    pedidos: filtered,
    allPedidos: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    filter,
    setFilter,
  };
}
