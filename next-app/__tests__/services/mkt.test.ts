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
  generateClientOrderKey,
  buyShirt,
  fetchShirts,
  addItemToCart,
  removeItemFromCart,
  changeItemQty,
  cartTotal,
  cartCount,
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
  or: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
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
    or: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    rpc: vi.fn(),
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
    // Filtros que o service encadeia mas o fake não precisa interpretar: o
    // recorte real é do PostgREST. Faltando aqui, viravam "x is not a
    // function" e derrubavam 7 testes de fetchProducts/submitOrder.
    or: (filter: string) => {
      spies.or(filter);
      return chain;
    },
    gte: (col: string, val: unknown) => {
      spies.gte(col, val);
      return chain;
    },
    neq: () => chain,
    ilike: () => chain,
    in: () => chain,
    is: () => chain,
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
    // sb.rpc(name, args) — ponto de entrada separado do .from(...) chain,
    // mas consome da MESMA fila (ordem importa nos testes que o usam).
    rpc: (name: string, args: unknown) => {
      spies.rpc(name, args);
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
  it('categoriza tintas por keyword; esmalte sintético é madeiras & metais', () => {
    expect(mktClassify({ name: 'Tinta Acrílica Premium' })).toBe('tintas');
    // Esmalte sintético não-automotivo tem regra própria (é tinta de madeira
    // e metal) e cai em madeiras_metais, não no balaio de tintas imobiliárias.
    expect(mktClassify({ name: 'Esmalte sintético tradicional' })).toBe('madeiras_metais');
    expect(mktClassify({ name: 'Esmalte sintético automotivo' })).not.toBe('madeiras_metais');
  });

  it('overrides por marca: vonixx → estética automotiva, metalatex/novacor → tintas', () => {
    // O vanilla jogava Vonixx em "outros" porque não existia menu de estética
    // automotiva; existe desde então, e a marca é inteira dessa categoria.
    expect(mktClassify({ name: 'Vonixx Cera de Carnaúba' })).toBe('estetica_automotiva');
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

  // A4 (01/09/2026): a soma acumulava float — 89,90 × 3 dava
  // 269.70000000000005, e esse número ia PRO PEDIDO. A tela arredondava na
  // exibição, então o resíduo só aparecia no banco.
  it('cartTotal não deixa resíduo de ponto flutuante', () => {
    const items = [
      { id: 'a', name: 'Tinta', price: 89.9, qty: 3 },
    ] as unknown as Parameters<typeof cartTotal>[0];
    expect(cartTotal(items)).toBe(269.7);
  });

  it('cartTotal soma centavos exatos entre itens diferentes', () => {
    const items = [
      { id: 'a', name: 'A', price: 19.99, qty: 3 },
      { id: 'b', name: 'B', price: 5.5, qty: 2 },
    ] as unknown as Parameters<typeof cartTotal>[0];
    expect(cartTotal(items)).toBe(70.97);
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

describe('generateClientOrderKey', () => {
  it('gera chaves diferentes a cada chamada (não é constante)', () => {
    const a = generateClientOrderKey();
    const b = generateClientOrderKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('nunca usa Math.random (js/insecure-randomness) — só Web Crypto', () => {
    const spy = vi.spyOn(Math, 'random');
    generateClientOrderKey();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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
    // 1a resposta: a busca por pedido pendente recente (dedupe); 2a: o insert.
    const { client, spies } = makeFakeClient([
      { data: [] },
      { data: { id: 'order-uuid' } },
    ]);
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
    const { client } = makeFakeClient([{ data: [] }, { data: {} }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      submitOrder('u1', [{ id: 'a', name: 'A', price: 10, qty: 1 }])
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('pedido pendente recente com os mesmos itens → reusa o id, sem inserir', async () => {
    // Clicar "Enviar Lista" duas vezes nao pode virar dois pedidos orfaos.
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 10, qty: 2 }];
    const { client, spies } = makeFakeClient([
      {
        data: [
          {
            id: 'order-ja-existente',
            items,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await submitOrder('u1', items);
    expect(out).toEqual({ orderId: 'order-ja-existente', total: 20 });
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('error supabase → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: [] },
      { data: null, error: { message: 'fk violation' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      submitOrder('u1', [{ id: 'a', name: 'A', price: 10, qty: 1 }])
    ).rejects.toBeInstanceOf(NetworkError);
  });

  // ─── clientOrderKey: idempotência atômica via RPC (2026-09-26) ──────────

  it('com clientOrderKey: RPC nova (reused=false) — não passa pelo dedupe/insert legado', async () => {
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 10, qty: 2 }];
    const { client, spies } = makeFakeClient([
      { data: [{ order_id: 'order-rpc-novo', total: 20, reused: false }] },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await submitOrder('u1', items, null, 'chave-1');
    expect(out).toEqual({ orderId: 'order-rpc-novo', total: 20 });
    expect(spies.rpc).toHaveBeenCalledWith('submit_order_idempotent', {
      p_items: items,
      p_total: 20,
      p_client_order_key: 'chave-1',
    });
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('com clientOrderKey: RPC devolve pedido já existente (reused=true) — mesmo id, sem duplicar', async () => {
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 10, qty: 1 }];
    const { client, spies } = makeFakeClient([
      { data: [{ order_id: 'order-ja-existente', total: 10, reused: true }] },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out1 = await submitOrder('u1', items, null, 'chave-2');
    expect(out1.orderId).toBe('order-ja-existente');
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('com clientOrderKey mas RPC ainda não existe no banco (42883) — cai no dedupe/insert legado', async () => {
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 10, qty: 1 }];
    const { client, spies } = makeFakeClient([
      { data: null, error: { code: '42883', message: 'function does not exist' } },
      { data: [] }, // dedupe legado: nenhum pending recente
      { data: { id: 'order-legado' } }, // insert legado
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await submitOrder('u1', items, null, 'chave-3');
    expect(out).toEqual({ orderId: 'order-legado', total: 10 });
    expect(spies.insert).toHaveBeenCalledTimes(1);
  });

  it('com clientOrderKey e RPC falha por outro motivo → NetworkError, sem cair no legado', async () => {
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 10, qty: 1 }];
    const { client, spies } = makeFakeClient([
      { data: null, error: { code: '23514', message: 'carrinho vazio' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      submitOrder('u1', items, null, 'chave-4')
    ).rejects.toBeInstanceOf(NetworkError);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('sem clientOrderKey: comportamento antigo intocado (nenhuma chamada de rpc)', async () => {
    const items: CartItem[] = [{ id: 'a', name: 'A', price: 10, qty: 1 }];
    const { client, spies } = makeFakeClient([
      { data: [] },
      { data: { id: 'order-sem-chave' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await submitOrder('u1', items);
    expect(out.orderId).toBe('order-sem-chave');
    expect(spies.rpc).not.toHaveBeenCalled();
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
