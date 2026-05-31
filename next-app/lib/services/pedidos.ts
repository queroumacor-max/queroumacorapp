// pedidos.ts — service layer para a tabela `orders` (compras na loja Cali Colors).
// Espelha a parte de "store orders" de modules/pedidos.js do vanilla
// (loadPedidos), sem o ramo de `quotes` — esse vai pra um service separado
// quando portarmos a tela de orçamentos.
//
// Schema (supabase_init.sql linhas 425-432 + 1116-1124):
//   id uuid, user_id uuid, items jsonb, total numeric, status text,
//   created_at timestamptz, gateway, payment_url, tx_id, paid_amount,
//   paid_at, payment_method, installments, receipt_url
// Política RLS (linha 437-438): só dono lê (`auth.uid() = user_id`), então
// a query depende do user estar autenticado.
//
// `updated_at` e `tracking_code` ainda não existem no schema atual; o
// `select` lista o que o frontend usaria SE/quando rolarem migrations futuras.
// Como Supabase aceita colunas inexistentes no select (devolve null) só
// quando explícito, mantemos só o subset garantido pra não estourar 400.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';
import type { Order } from '@/lib/types';

// Colunas que existem hoje no schema. Quando `tracking_code`/`updated_at`
// forem adicionados por migration, atualizar aqui — frontend já está pronto
// pra consumir esses campos opcionais sem mudança no shape.
const ORDER_COLS = 'id, user_id, status, items, total, paid_amount, created_at';

// 50 é o limite pedido pelo spec; bate com a UX de "últimos pedidos" sem
// virar página gigante. Pra paginação cursor-based, opt-in via options.
const DEFAULT_LIMIT = 50;

export interface FetchPedidosOptions {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

export interface PedidosPage {
  items: Order[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Busca os pedidos da loja do usuário em ordem reverse-chronological.
 * Retorna [] se userId vazio (consistente com fetchNotifications) pra que o
 * caller não precise checar antes — null seria mais ergonômico mas quebra
 * o invariante `Array.isArray(pedidos)` em quem consome o resultado.
 *
 * Sobrecarga: sem options retorna `Order[]` (back-compat); com options
 * retorna `PedidosPage` com cursor + signal pra infinite scroll/cancel.
 */
export async function fetchPedidos(userId: string): Promise<Order[]>;
export async function fetchPedidos(
  userId: string,
  options: FetchPedidosOptions,
): Promise<PedidosPage>;
export async function fetchPedidos(
  userId: string,
  options?: FetchPedidosOptions,
): Promise<Order[] | PedidosPage> {
  if (!userId) {
    return options ? { items: [], nextCursor: null, hasMore: false } : [];
  }
  const limit = Math.max(1, options?.limit ?? DEFAULT_LIMIT);
  const cursor = options?.cursor ?? null;
  const signal = options?.signal;
  const sb = getSupabase();
  let q = sb
    .from('orders')
    .select(ORDER_COLS)
    .eq('user_id', userId);
  if (cursor) {
    q = q.lt('created_at', cursor);
  }
  q = q.order('created_at', { ascending: false }).limit(limit);
  const qFinal = signal
    ? (q as unknown as { abortSignal: (s: AbortSignal) => typeof q }).abortSignal(signal)
    : q;
  const { data, error } = await qFinal;
  if (error) {
    throw new NetworkError(error.message, error);
  }
  // cast via unknown — DB devolve `items: Json` (jsonb genérico), e o
  // domain type Order tipa `items: OrderItem[]`. Em runtime é a mesma
  // string JSON; o cast só silencia o type system. Zod/validation
  // poderia parsear estrito, mas Order é loose-shape no app.
  const items = (data ?? []) as unknown as Order[];
  if (!options) return items;
  const last = items[items.length - 1] as { created_at?: string | null } | undefined;
  const nextCursor = last?.created_at ?? null;
  const hasMore = items.length >= limit && !!nextCursor;
  return { items, nextCursor, hasMore };
}
