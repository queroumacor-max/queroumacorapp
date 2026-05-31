// search.ts — service layer pra busca full-text agregada (Banco#9).
// Cobre 3 tabelas via Postgres tsvector + GIN: profiles, posts, products.
// Backend = função RPC `search_all(p_query, p_limit)` definida na migration
// `migrations/2026-05-31-fulltext-search.sql`.
//
// Decisões:
//  - Min length 2: query curta demais retorna [] sem bater na rede (mesmo
//    pattern de chat-users.searchUsers). Evita resposta gigante pra "a".
//  - Trim antes do length check: " a " conta como 1 char, não 3 — coerente
//    com plainto_tsquery que ignora whitespace.
//  - Sem catch silencioso: erro do RPC vira Error com message do Supabase
//    pra que o caller (useSearch) consiga mostrar UI de retry. Mesmo padrão
//    de notifications.ts (que joga NetworkError).
//  - Cast em data: sb.rpc('search_all') retorna unknown se a Function não
//    está tipada em database.types.ts; o shape garantido é o que a migration
//    declara em RETURNS TABLE.

import { getSupabase } from '@/lib/supabase';

export type SearchResultType = 'profile' | 'post' | 'product';

export interface SearchResult {
  result_type: SearchResultType;
  id: string;
  title: string;
  snippet: string;
  score: number;
}

// Query precisa de pelo menos 2 chars pra valer um round-trip ao banco.
// Espelha SEARCH_MIN_QUERY_LENGTH de chat-users.ts.
const SEARCH_MIN_QUERY_LENGTH = 2;

/**
 * Busca agregada em profiles + posts + products via RPC `search_all`.
 * Retorna [] se a query for vazia/curta (< 2 chars trim).
 *
 * Resultados vêm ordenados por `score` DESC (ts_rank do Postgres) — o backend
 * já faz o sort, o caller não precisa re-ordenar. `limit` é cap server-side;
 * default 20 cobre a tela inicial sem precisar de paginação.
 */
export async function searchAll(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  const q = (query ?? '').trim();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];

  const sb = getSupabase();
  // Cast: a Function search_all não está tipada em database.types.ts (gerada
  // manualmente, fora do `supabase gen types`). O contrato é o shape da
  // RETURNS TABLE da migration. `as unknown as` é o cast canônico pra RPC
  // não tipada, alinhado com os outros services do projeto.
  const { data, error } = await (sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: SearchResult[] | null; error: { message: string } | null }>)(
    'search_all',
    { p_query: q, p_limit: limit },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as SearchResult[];
}
