// Tests do service lib/services/mkt.ts.
// Pattern alinhado com leads.test.ts / pedidos.test.ts:
//   - fake supabase chainable injetado via __setSupabaseForTests;
//   - cobre as funções puras (resolveColorHex, mktClassify, cart helpers)
//     SEM tocar em rede, e as funções de IO (fetchProducts, fetchProduct,
//     fetchCart, saveCart, submitOrder, buyShirt) com fake client em queue.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  resolveColorHex,
  productBg,
  mktClassify,
  isMktHidden,
  fetchProducts,
  fetchProduct,
  fetchCart,
  saveCart,
  submitOrder,
  buyShirt,
  fetchShirts,
  addItemToCart,
  removeItemFromCart,
  changeItemQty,
  cartTotal,
  cartCount,
  parseProductSize,
  groupProductsBySize,
  type Product,
  type CartItem,
} from '../../lib/services/mkt';
import {
  NetworkError,
  ValidationError,
  AuthorizationError,
} from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

interface QueueItem {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

function makeFakeClient(queue: QueueItem[] = []): {
  client: unknown;
  spies: ChainSpies;
} {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };

  const responses = [...queue];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

  // single() e maybeSingle() resolvem direto numa Promise (não chainable
  // depois) — mesmo trick que o supabase-js usa.
  const chain: Record<string, unknown> = {
    from: (t: string) => {
      spies.from(t);
      return chain;
    },
    select: (cols: string, opts?: { count?: 'exact' }) => {
      // Só forward `opts` quando definido — preserva assinatura de chamadas
      // legadas (cart, etc.) que chamam .select('cart') sem 2º arg.
      if (opts === undefined) spies.select(cols);
      else spies.select(cols, opts);
      return chain;
    },
    insert: (row: unknown) => {
      spies.insert(row);
      return chain;
    },
    update: (patch: unknown) => {
      spies.update(patch);
      return chain;
    },
    eq: (col: string, val: unknown) => {
      spies.eq(col, val);
      return chain;
    },
    order: (col: string, opts?: { ascending: boolean }) => {
      spies.order(col, opts);
      return chain;
    },
    limit: (n: number) => {
      spies.limit(n);
      return chain;
    },
    range: (from: number, to: number) => {
      spies.range(from, to);
      return chain;
    },
    single: () => {
      spies.single();
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    maybeSingle: () => {
      spies.maybeSingle();
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    then: (resolve: (v: { data: unknown; error: unknown; count: number | null }) => void) => {
      const r = nextResponse();
      resolve({
        data: r.data ?? null,
        error: r.error ?? null,
        // Default count = length da data quando não passado explicitamente —
        // simula PostgREST com `{ count: 'exact' }` em uma única página.
        count: r.count ?? (Array.isArray(r.data) ? r.data.length : null),
      });
    },
  };

  return { client: chain, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── funções puras: cor ───────────────────────────────────────────────────

describe('resolveColorHex', () => {
  it('usa color_hex se for cor real (não-placeholder)', () => {
    expect(resolveColorHex({ name: 'Tinta', color_hex: '#abcdef' })).toBe('#abcdef');
  });

  it('ignora placeholder e infere do nome via COLOR_DICT', () => {
    // c0622d é um dos placeholders listados.
    expect(resolveColorHex({ name: 'Tinta Vermelho', color_hex: '#c0622d' })).toBe('#c0392b');
  });

  it('volta null se não tem hex nem match no nome', () => {
    expect(resolveColorHex({ name: 'Produto xyz', color_hex: null })).toBeNull();
  });

  it('aceita null/undefined sem estourar', () => {
    expect(resolveColorHex(null)).toBeNull();
    expect(resolveColorHex(undefined)).toBeNull();
  });
});

describe('productBg', () => {
  it('usa gradient se presente (formato linear-gradient)', () => {
    expect(
      productBg({
        id: 'p',
        name: 'x',
        price: 0,
        color_gradient: '#fff,#000',
      })
    ).toBe('linear-gradient(135deg,#fff,#000)');
  });

  it('fallback pra cor sólida resolvida do nome', () => {
    expect(productBg({ id: 'p', name: 'Tinta preto', price: 0 })).toBe('#1a1a1a');
  });

  it('fallback final é o cinza-creme default', () => {
    expect(productBg({ id: 'p', name: 'xxx desconhecido', price: 0 })).toBe('#e8e2d9');
  });
});

// ─── funções puras: classify ──────────────────────────────────────────────

describe('mktClassify', () => {
  it('categoriza tintas por keyword (acrilica, esmalte, etc.)', () => {
    expect(mktClassify({ name: 'Tinta Acrílica Premium' })).toBe('tintas');
    expect(mktClassify({ name: 'Esmalte sintético tradicional' })).toBe('tintas');
  });

  it('exceções vanilla: vonixx → outros, metalatex/novacor → tintas', () => {
    expect(mktClassify({ name: 'Vonixx Cera de Carnaúba' })).toBe('outros');
    expect(mktClassify({ name: 'Metalatex Litoral' })).toBe('tintas');
    expect(mktClassify({ name: 'Novacor Esmalte' })).toBe('tintas');
  });

  it('caminho default: produtos sem match viram outros', () => {
    expect(mktClassify({ name: 'Produto que não bate em nada' })).toBe('outros');
  });

  it('arte_urbana ganha precedência por aparecer primeiro no menu', () => {
    expect(mktClassify({ name: 'Spray Arte Urbana 400ml' })).toBe('arte_urbana');
  });
});

describe('isMktHidden', () => {
  it('esconde bases tinturométricas', () => {
    expect(isMktHidden({ name: 'Tinta Base VY 18L' })).toBe(true);
    expect(isMktHidden({ name: 'BASE Z 3.6L' })).toBe(true);
  });

  it('não esconde produtos normais', () => {
    expect(isMktHidden({ name: 'Tinta Acrílica Premium' })).toBe(false);
  });
});

// ─── funções puras: cart helpers ──────────────────────────────────────────

describe('cart helpers (puros)', () => {
  const prod = {
    id: 'p1',
    name: 'Tinta',
    price: 100,
    color_hex: '#fff',
    color_gradient: null,
    volume: '18L',
  };

  it('addItemToCart cria item novo quando não existe', () => {
    const out = addItemToCart([], prod, 2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'p1', qty: 2, price: 100 });
  });

  it('addItemToCart soma qty quando item já existe', () => {
    const initial: CartItem[] = [{ id: 'p1', name: 'Tinta', price: 100, qty: 3 }];
    const out = addItemToCart(initial, prod, 2);
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(5);
  });

  it('addItemToCart clampa qty mínimo em 1 e não muta o input', () => {
    const initial: CartItem[] = [];
    const out = addItemToCart(initial, prod, 0);
    expect(out[0].qty).toBe(1);
    expect(initial).toHaveLength(0); // não mutou
  });

  it('removeItemFromCart tira só o id alvo', () => {
    const items: CartItem[] = [
      { id: 'a', name: 'A', price: 1, qty: 1 },
      { id: 'b', name: 'B', price: 2, qty: 1 },
    ];
    expect(removeItemFromCart(items, 'a').map((i) => i.id)).toEqual(['b']);
  });

  it('changeItemQty soma delta e remove quando qty cai pra 0', () => {
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 10, qty: 1 }];
    expect(changeItemQty(items, 'a', -1)).toEqual([]);
    expect(changeItemQty(items, 'a', 2)[0].qty).toBe(3);
  });

  it('cartTotal soma price*qty corretamente', () => {
    const items: CartItem[] = [
      { id: 'a', name: 'A', price: 10, qty: 2 },
      { id: 'b', name: 'B', price: 5.5, qty: 4 },
    ];
    expect(cartTotal(items)).toBe(42);
  });

  it('cartCount soma todas as unidades (não itens distintos)', () => {
    const items: CartItem[] = [
      { id: 'a', name: 'A', price: 10, qty: 3 },
      { id: 'b', name: 'B', price: 5, qty: 2 },
    ];
    expect(cartCount(items)).toBe(5);
  });
});

// ─── IO: fetchProducts ────────────────────────────────────────────────────

describe('fetchProducts', () => {
  it('happy path: retorna produtos visíveis e filtra os hidden', async () => {
    const rows: Product[] = [
      { id: 'p1', name: 'Tinta Acrílica', price: 100 },
      { id: 'p2', name: 'BASE VY 18L', price: 200 }, // hidden
      { id: 'p3', name: 'Esmalte', price: 50 },
    ];
    const { client, spies } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await fetchProducts();
    expect(out.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(spies.from).toHaveBeenCalledWith('products');
    expect(spies.order).toHaveBeenCalledWith('name', undefined);
    // Pagination paralela: 1ª página com count exato via .range(0, 999).
    expect(spies.range).toHaveBeenCalledWith(0, 999);
    expect(spies.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
  });

  it('filter.category aplica mktClassify e devolve só matches', async () => {
    const rows: Product[] = [
      { id: 'p1', name: 'Tinta Acrílica Premium', price: 100 },
      { id: 'p2', name: 'Spray Arte Urbana', price: 30 },
      { id: 'p3', name: 'Pincel trincha', price: 10 },
    ];
    const { client } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchProducts({ category: 'tintas' });
    expect(out.map((p) => p.id)).toEqual(['p1']);
  });

  it('filter.search match em name e code (case-insensitive)', async () => {
    const rows: Product[] = [
      { id: 'p1', name: 'Tinta XPTO', code: 'ABC123', price: 100 },
      { id: 'p2', name: 'Outro', code: 'XYZ999', price: 50 },
    ];
    const { client } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchProducts({ search: 'xpto' });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('p1');
  });

  it('error path → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchProducts()).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── IO: fetchProduct ─────────────────────────────────────────────────────

describe('fetchProduct', () => {
  it('id vazio → resolve null sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([{ data: { id: 'p1' } }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchProduct('');
    expect(out).toBeNull();
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: usa eq("id") + maybeSingle', async () => {
    const prod: Product = { id: 'p1', name: 'Tinta', price: 100 };
    const { client, spies } = makeFakeClient([{ data: prod }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchProduct('p1');
    expect(out).toEqual(prod);
    expect(spies.eq).toHaveBeenCalledWith('id', 'p1');
    expect(spies.maybeSingle).toHaveBeenCalled();
  });

  it('not-found (data=null sem erro) → resolve null', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchProduct('inexistente');
    expect(out).toBeNull();
  });

  it('error → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'boom' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchProduct('p1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── IO: fetchCart ────────────────────────────────────────────────────────

describe('fetchCart', () => {
  it('userId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchCart('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: devolve array do profiles.cart', async () => {
    const cart: CartItem[] = [{ id: 'a', name: 'A', price: 1, qty: 1 }];
    const { client, spies } = makeFakeClient([{ data: { cart } }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchCart('u1');
    expect(out).toEqual(cart);
    expect(spies.from).toHaveBeenCalledWith('profiles');
    expect(spies.select).toHaveBeenCalledWith('cart');
    expect(spies.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('cart null/non-array → resolve []', async () => {
    const { client } = makeFakeClient([{ data: { cart: null } }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await fetchCart('u1')).toEqual([]);
  });

  it('filtra items corrompidos (sem id)', async () => {
    const { client } = makeFakeClient([
      { data: { cart: [{ id: 'ok', name: 'X', price: 1, qty: 1 }, { name: 'sem-id' }] } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchCart('u1');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ok');
  });

  it('error → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchCart('u1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── IO: saveCart ─────────────────────────────────────────────────────────

describe('saveCart', () => {
  it('userId vazio → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveCart('', [])).rejects.toBeInstanceOf(ValidationError);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('happy path: update profiles.cart com eq(id, userId)', async () => {
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 1, qty: 1 }];
    const { client, spies } = makeFakeClient([{ data: null, error: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await saveCart('u1', items);
    expect(spies.from).toHaveBeenCalledWith('profiles');
    expect(spies.update).toHaveBeenCalledWith({ cart: items });
    expect(spies.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('error supabase → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveCart('u1', [])).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── IO: submitOrder ──────────────────────────────────────────────────────

describe('submitOrder', () => {
  it('userId vazio → AuthorizationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      submitOrder('', [{ id: 'a', name: 'A', price: 10, qty: 1 }])
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('items vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(submitOrder('u1', [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: insere order com total calculado e retorna orderId', async () => {
    const items: CartItem[] = [
      { id: 'a', name: 'A', price: 10, qty: 2 },
      { id: 'b', name: 'B', price: 5, qty: 4 },
    ];
    const { client, spies } = makeFakeClient([{ data: { id: 'order-uuid' } }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await submitOrder('u1', items);
    expect(out).toEqual({ orderId: 'order-uuid', total: 40 });
    expect(spies.from).toHaveBeenCalledWith('orders');
    // insert recebe o payload com total agregado.
    const insertedPayload = spies.insert.mock.calls[0][0] as {
      user_id: string;
      items: CartItem[];
      total: number;
      status: string;
    };
    expect(insertedPayload.user_id).toBe('u1');
    expect(insertedPayload.total).toBe(40);
    expect(insertedPayload.status).toBe('pending');
    expect(insertedPayload.items).toEqual(items);
  });

  it('insert sem id retornado → NetworkError (não retorna orderId vazio)', async () => {
    const { client } = makeFakeClient([{ data: {} }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      submitOrder('u1', [{ id: 'a', name: 'A', price: 10, qty: 1 }])
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('error supabase → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'fk violation' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      submitOrder('u1', [{ id: 'a', name: 'A', price: 10, qty: 1 }])
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── IO: buyShirt + fetchShirts ───────────────────────────────────────────

describe('fetchShirts', () => {
  it('retorna catálogo hardcoded com shirt-personalizada', async () => {
    const out = await fetchShirts();
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].id).toBe('shirt-personalizada');
    expect(out[0].basePrice).toBe(39.9);
  });
});

describe('buyShirt', () => {
  it('userId vazio → AuthorizationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      buyShirt('', { color: '#fff', size: 'M', qty: 1 })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('aplica desconto bulk (>= 5 unidades) e adiciona ao cart', async () => {
    // fetchCart (single) + saveCart (await chain) — 2 respostas.
    const { client, spies } = makeFakeClient([
      { data: { cart: [] } },
      { data: null, error: null },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await buyShirt('u1', { color: '#000', size: 'G', qty: 5 });
    // 39.90 * 0.85 = 33.915
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(5);
    expect(out[0].price).toBeCloseTo(33.915, 3);
    expect(out[0].customization).toMatchObject({ color: '#000', size: 'G' });
    // Verifica que chamou saveCart (update no profiles).
    expect(spies.update).toHaveBeenCalled();
  });

  it('qty < 5 usa preço base sem desconto', async () => {
    const { client } = makeFakeClient([
      { data: { cart: [] } },
      { data: null, error: null },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await buyShirt('u1', { color: '#fff', size: 'M', qty: 2 });
    expect(out[0].price).toBe(39.9);
  });

  it('shirtId desconhecido → ValidationError', async () => {
    const { client } = makeFakeClient([
      { data: { cart: [] } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      buyShirt('u1', { color: '#fff', size: 'M', qty: 1, shirtId: 'nao-existe' })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── unificação por tamanho (2026-06-16) ─────────────────────────────────────

describe('parseProductSize', () => {
  it('extrai sufixo de litros', () => {
    expect(parseProductSize('NOVACOR COBRE MAIS BRANCO 18L')).toEqual({
      base: 'NOVACOR COBRE MAIS BRANCO',
      size: '18L',
    });
  });

  it('extrai galão com vírgula', () => {
    expect(parseProductSize('NOVACOR COBRE MAIS BRANCO 3,6L')).toEqual({
      base: 'NOVACOR COBRE MAIS BRANCO',
      size: '3,6L',
    });
  });

  it('extrai mililitros', () => {
    expect(parseProductSize('ACELERADOR SEC 900ML')).toEqual({
      base: 'ACELERADOR SEC',
      size: '900ML',
    });
  });

  it('sem sufixo de tamanho → size null', () => {
    expect(parseProductSize('ROLO DE LÃ 23CM')).toEqual({
      base: 'ROLO DE LÃ 23CM',
      size: null,
    });
  });
});

describe('groupProductsBySize', () => {
  const mk = (id: string, name: string, line: string | null = 'Premium'): Product => ({
    id,
    name,
    price: 10,
    line,
  });

  it('unifica mesmo produto em tamanhos diferentes num grupo só', () => {
    const groups = groupProductsBySize([
      mk('1', 'TINTA BRANCA 18L'),
      mk('2', 'TINTA BRANCA 3,6L'),
      mk('3', 'TINTA BRANCA 900ML'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].base).toBe('TINTA BRANCA');
    // Ordenado menor → maior (900ml < 3,6L < 18L).
    expect(groups[0].products.map((p) => p.id)).toEqual(['3', '2', '1']);
  });

  it('linhas diferentes não se misturam', () => {
    const groups = groupProductsBySize([
      mk('1', 'TINTA BRANCA 18L', 'Premium'),
      mk('2', 'TINTA BRANCA 18L', 'Econômica'),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('produto sem tamanho fica avulso (grupo de 1)', () => {
    const groups = groupProductsBySize([mk('1', 'PINCEL CHATO')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].products).toHaveLength(1);
  });

  it('preserva ordem de aparição do primeiro membro', () => {
    const groups = groupProductsBySize([
      mk('1', 'PINCEL CHATO'),
      mk('2', 'TINTA BRANCA 18L'),
      mk('3', 'TINTA BRANCA 3,6L'),
    ]);
    expect(groups.map((g) => g.base)).toEqual(['PINCEL CHATO', 'TINTA BRANCA']);
  });
});
