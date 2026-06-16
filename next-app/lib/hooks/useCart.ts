// useCart — hook React que centraliza leitura/escrita do carrinho da loja
// (`profiles.cart`) via TanStack Query. Substitui o trio `cartItems` + `saveCart`
// + `updateCartBadge` do vanilla (modules/mkt.js).
//
// Design:
//   - useQuery faz fetch + cache (staleTime 60s — carrinho não muda no
//     servidor sem ação do usuário; refetch raro);
//   - useMutation cobre add/remove/changeQty/clear com OPTIMISTIC UPDATE:
//     `onMutate` aplica a mudança no cache imediatamente, `onError` faz
//     rollback pro snapshot anterior. Isso mata o latency-perception de
//     "esperar o servidor pra ver o item no carrinho".
//   - Checkout (submit) dispara submitOrder e devolve { orderId, total }
//     pro caller decidir o que fazer (chamar /api/mp-checkout-loja e
//     redirecionar). O hook não toca window.location porque (a) facilita
//     teste e (b) UI controla a UX de loading/redirect.

'use client';

import { useRef } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchCart,
  saveCart,
  submitOrder,
  addItemToCart,
  removeItemFromCart,
  changeItemQty,
  cartTotal,
  cartCount,
  type CartItem,
  type Product,
  type ProductVariant,
  type OrderSubmitResult,
} from '@/lib/services/mkt';

// Context da mutation pra rollback otimista. Snapshot do array antes do
// mutate; em caso de erro, restauramos via setQueryData.
interface MutationContext {
  prev: CartItem[];
}

interface AddArg {
  product: Pick<Product, 'id' | 'name' | 'price' | 'color_hex' | 'color_gradient' | 'volume'>;
  qty: number;
  // Wave 25 — opcional. Quando passa, item entra no carrinho como linha
  // separada com price/label da variante.
  variant?: ProductVariant | null;
}

interface ChangeQtyArg {
  id: string;
  delta: number;
}

export interface UseCartResult {
  items: CartItem[];
  count: number;
  total: number;
  loading: boolean;
  error: Error | null;
  add: (arg: AddArg) => void;
  remove: (id: string) => void;
  changeQty: (arg: ChangeQtyArg) => void;
  clear: () => void;
  /** Limpa o carrinho de forma awaitable (persiste vazio em profiles.cart).
   *  Usado pelo checkout pra só esvaziar após estado terminal de sucesso. */
  clearCart: () => Promise<void>;
  /** Cria o pedido. `address` = endereço de entrega (texto livre). */
  checkout: (address?: string) => Promise<OrderSubmitResult>;
  isMutating: boolean;
  mutationError: Error | null;
  isCheckingOut: boolean;
  checkoutError: Error | null;
}

export function useCart(): UseCartResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ['cart', user?.id] as const;
  // Snapshot pré-otimista para o qtyMutation — evita aplicar delta duas
  // vezes (mutationFn roda após onMutate que já atualizou o cache).
  const qtyPrevRef = useRef<CartItem[]>([]);

  const query = useQuery<CartItem[], Error>({
    queryKey,
    queryFn: () => fetchCart(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  // Mutation genérica de gravação. Os 3 verbs (add/remove/changeQty/clear)
  // todos resolvem pra "calcula novo array, persiste". O cálculo otimista
  // varia por verb, então cada um tem sua mutation pra que `onMutate`
  // saiba o que aplicar.

  const addMutation = useMutation<CartItem[], Error, AddArg, MutationContext>({
    // BUG FIX: o `onMutate` JÁ aplicou o add otimista no cache. O mutationFn
    // só persiste esse estado — antes ele lia o cache (já incrementado) e
    // chamava addItemToCart DE NOVO, dobrando a quantidade (add 1 → virava 2).
    mutationFn: async () => {
      const next = qc.getQueryData<CartItem[]>(queryKey) ?? [];
      await saveCart(user!.id, next);
      return next;
    },
    onMutate: async ({ product, qty, variant }): Promise<MutationContext> => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CartItem[]>(queryKey) ?? [];
      qc.setQueryData<CartItem[]>(
        queryKey,
        addItemToCart(prev, product, qty, variant ?? null),
      );
      return { prev };
    },
    onError: (_err, _arg, ctx) => {
      if (ctx) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const removeMutation = useMutation<CartItem[], Error, string, MutationContext>({
    mutationFn: async (id) => {
      const current = qc.getQueryData<CartItem[]>(queryKey) ?? [];
      const next = removeItemFromCart(current, id);
      await saveCart(user!.id, next);
      return next;
    },
    onMutate: async (id): Promise<MutationContext> => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CartItem[]>(queryKey) ?? [];
      qc.setQueryData<CartItem[]>(queryKey, removeItemFromCart(prev, id));
      return { prev };
    },
    onError: (_err, _arg, ctx) => {
      if (ctx) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const qtyMutation = useMutation<CartItem[], Error, ChangeQtyArg, MutationContext>({
    mutationFn: async ({ id, delta }) => {
      // BUG FIX: usar snapshot pré-otimista (qtyPrevRef) em vez de
      // qc.getQueryData() — que já contém o update otimista do onMutate,
      // causando aplicação dupla do delta (ex: -1 virava -2).
      const next = changeItemQty(qtyPrevRef.current, id, delta);
      await saveCart(user!.id, next);
      return next;
    },
    onMutate: async ({ id, delta }): Promise<MutationContext> => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CartItem[]>(queryKey) ?? [];
      qtyPrevRef.current = prev; // salva antes do update otimista
      qc.setQueryData<CartItem[]>(queryKey, changeItemQty(prev, id, delta));
      return { prev };
    },
    onError: (_err, _arg, ctx) => {
      if (ctx) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const clearMutation = useMutation<void, Error, void, MutationContext>({
    mutationFn: async () => {
      await saveCart(user!.id, []);
    },
    onMutate: async (): Promise<MutationContext> => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CartItem[]>(queryKey) ?? [];
      qc.setQueryData<CartItem[]>(queryKey, []);
      return { prev };
    },
    onError: (_err, _arg, ctx) => {
      if (ctx) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  // Checkout — não é otimista (não dá pra "fingir" criação do pedido).
  // NÃO limpa o carrinho aqui: a limpeza é decisão do CartView e só deve
  // acontecer quando o checkout chega num estado terminal de sucesso
  // (redirect pro MP ou fallback "loja entrará em contato"). Se o passo do
  // pagamento falhar, o carrinho precisa sobreviver pra o usuário tentar de
  // novo (e o submitOrder faz dedupe pra não duplicar o pedido pending).
  const checkoutMutation = useMutation<OrderSubmitResult, Error, string | undefined>({
    mutationFn: async (address) => {
      const items = qc.getQueryData<CartItem[]>(queryKey) ?? [];
      return submitOrder(user!.id, items, address);
    },
    onSuccess: () => {
      // Reflete a nova order na tela /pedidos. Carrinho intocado de propósito.
      qc.invalidateQueries({ queryKey: ['pedidos', user?.id] });
    },
  });

  const items = query.data ?? [];
  const isMutating =
    addMutation.isPending ||
    removeMutation.isPending ||
    qtyMutation.isPending ||
    clearMutation.isPending;
  const mutationError =
    addMutation.error ??
    removeMutation.error ??
    qtyMutation.error ??
    clearMutation.error ??
    null;

  return {
    items,
    count: cartCount(items),
    total: cartTotal(items),
    loading: query.isLoading,
    error: query.error ?? null,
    add: addMutation.mutate,
    remove: removeMutation.mutate,
    changeQty: qtyMutation.mutate,
    clear: () => clearMutation.mutate(),
    clearCart: () => clearMutation.mutateAsync(),
    checkout: (address?: string) => checkoutMutation.mutateAsync(address),
    isMutating,
    mutationError,
    isCheckingOut: checkoutMutation.isPending,
    checkoutError: checkoutMutation.error ?? null,
  };
}
