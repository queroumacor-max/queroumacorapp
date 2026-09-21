// stores.ts — catálogo de lojas parceiras que aparece no StoreSelector da
// /loja. Fonte única é o banco (tabela `stores`, cadastrada pelo portal) —
// hoje só tem a Cali Colors, mas dá pra cadastrar loja nova sem deploy.
//
// O catálogo de FALLBACK só entra enquanto a migration
// `/migrations/2026-09-21-stores.sql` ainda não rodou (42P01) ou a
// consulta falha por qualquer motivo — a /loja é a porta de entrada da
// compra inteira, não pode ficar sem tela nenhuma por causa de SQL
// pendente. Mesmo padrão de `lib/services/clickRua.ts`.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export interface Store {
  id: string;
  name: string;
  subtitle: string | null;
  emoji: string;
  active: boolean;
  sort_order: number;
}

export const FALLBACK_STORES: Store[] = [
  {
    id: 'calicolors',
    name: 'Cali Colors',
    subtitle: 'Tintas, texturas e ferramentas',
    emoji: '🎨',
    active: true,
    sort_order: 0,
  },
];

interface RawStoreRow {
  id: string;
  name: string;
  subtitle: string | null;
  emoji: string | null;
  active: boolean | null;
  sort_order: number | null;
}

function storeFromRow(row: RawStoreRow): Store {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    emoji: row.emoji || '🏪',
    active: row.active !== false,
    sort_order: row.sort_order ?? 0,
  };
}

// Cast manual — tabela nova, ainda fora do schema TS gerado. Mesmo padrão
// de artReferences/product_variants/click_rua_editions.
function storesClient() {
  return getSupabase() as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: boolean,
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => PromiseLike<{
              data: RawStoreRow[] | null;
              error: { message: string; code?: string } | null;
            }>;
          };
        };
      };
    };
  };
}

/** Lojas ATIVAS, ordenadas pra exibir no grid do StoreSelector. */
export async function fetchStores(): Promise<Store[]> {
  const { data, error } = await storesClient()
    .from('stores')
    .select('id, name, subtitle, emoji, active, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    // 42P01 = a migration ainda não rodou. Cai no catálogo embutido no app
    // em vez de deixar a loja sem porta de entrada nenhuma.
    if (error.code === '42P01') return [...FALLBACK_STORES];
    throw new NetworkError(`Não foi possível carregar as lojas: ${error.message}`);
  }
  const rows = data ?? [];
  if (rows.length === 0) return [...FALLBACK_STORES];
  return rows.map(storeFromRow);
}
