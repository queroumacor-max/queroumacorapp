// Tests do service lib/services/pedidos.ts.
// Mesmo pattern de notifications.test.ts: fake supabase chainable injetado
// via __setSupabaseForTests, com spies em from/select/eq/order/limit pra
// asserções de "qual tabela, que coluna, que limite".
//
// Cobertura:
//   - fetchPedidos: happy path (retorna rows + filtros corretos), userId
//     vazio (no-op → []), data null (→ []), erro Supabase (→ NetworkError).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import { fetchPedidos } from '../../lib/services/pedidos';
import { NetworkError } from '../../lib/errors';
import type { Order } from '../../lib/types';

// ─── fake supabase chainable ───────────────────────────────────────────────
// Cada método retorna `chain` pra permitir composição em qualquer ordem.
// `then` no fim transforma o builder em await-able, devolvendo {data,error}.

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

interface FakeOpts {
  data?: unknown;
  error?: unknown;
}

function makeFakeClient(opts: FakeOpts = {}): { client: unknown; spies: ChainSpies } {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  const chain = {
    from: (t: string) => {
      spies.from(t);
      return chain;
    },
    select: (cols: string) => {
      spies.select(cols);
      return chain;
    },
    eq: (col: string, val: unknown) => {
      spies.eq(col, val);
      return chain;
    },
    order: (col: string, orderOpts: { ascending: boolean }) => {
      spies.order(col, orderOpts);
      return chain;
    },
    limit: (n: number) => {
      spies.limit(n);
      return chain;
    },
    // Vira await-able no final (mesmo trick que PostgrestBuilder).
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: opts.data ?? null, error: opts.error ?? null }),
  };

  return { client: chain, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  // Env vars setadas pra getSupabase() não estourar antes de
  // __setSupabaseForTests injetar o fake.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchPedidos ──────────────────────────────────────────────────────────

describe('fetchPedidos', () => {
  it('userId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient({ data: [{ id: 'o1' }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchPedidos('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna data e usa filtros corretos', async () => {
    const rows: Order[] = [
      {
        id: 'o1',
        user_id: 'u1',
        status: 'pago',
        items: [{ product_id: 'p1', name: 'Tinta branca 18L', qty: 2, price: 250 }],
        total: 500,
        created_at: '2026-05-31T10:00:00Z',
      },
      {
        id: 'o2',
        user_id: 'u1',
        status: 'pendente',
        items: [],
        total: 0,
        created_at: '2026-05-30T10:00:00Z',
      },
    ];
    const { client, spies } = makeFakeClient({ data: rows });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await fetchPedidos('u1');
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('orders');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
    // DEFAULT_LIMIT interno = 50 (spec).
    expect(spies.limit).toHaveBeenCalledWith(50);
  });

  it('empty: data=[] → resolve [] sem estourar', async () => {
    const { client } = makeFakeClient({ data: [] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchPedidos('u1');
    expect(out).toEqual([]);
  });

  it('data null → resolve [] (não [null])', async () => {
    const { client } = makeFakeClient({ data: null });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchPedidos('u1');
    expect(out).toEqual([]);
  });

  it('error path → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient({
      data: null,
      error: { message: 'rls bloqueou' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchPedidos('u1')).rejects.toBeInstanceOf(NetworkError);
    await expect(fetchPedidos('u1')).rejects.toMatchObject({
      message: 'rls bloqueou',
    });
  });
});
