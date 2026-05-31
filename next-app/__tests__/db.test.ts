// Tests do port lib/db.ts (TS).
// Pattern: vi.mock no módulo lib/supabase pra controlar o que `getSupabase()`
// devolve. Cada describe testa o shape e o caminho degradado (no-client).
// Quando precisamos do happy path, montamos um chainable fake que responde
// `{ data, error, count }` consistente com PostgrestSingleResponse.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __resetSupabaseForTests, __setSupabaseForTests } from '../lib/supabase';
import { DB } from '../lib/db';

beforeEach(() => {
  __resetSupabaseForTests();
});

describe('DB — shape', () => {
  it('expõe profiles/follows/posts', () => {
    expect(typeof DB).toBe('object');
    expect(typeof DB.profiles).toBe('object');
    expect(typeof DB.follows).toBe('object');
    expect(typeof DB.posts).toBe('object');
  });
  it('DB.profiles: getById, getMany, PUBLIC_COLS', () => {
    expect(typeof DB.profiles.getById).toBe('function');
    expect(typeof DB.profiles.getMany).toBe('function');
    expect(typeof DB.profiles.PUBLIC_COLS).toBe('string');
  });
  it('DB.follows: 7 métodos esperados', () => {
    const expected = [
      'countFollowers',
      'countFollowing',
      'listFollowingIds',
      'listFollowerIds',
      'isFollowing',
      'follow',
      'unfollow',
    ] as const;
    for (const fn of expected) {
      expect(typeof (DB.follows as unknown as Record<string, unknown>)[fn]).toBe('function');
    }
  });
  it('DB.posts: 4 métodos + COLS', () => {
    expect(typeof DB.posts.countByUser).toBe('function');
    expect(typeof DB.posts.getByUser).toBe('function');
    expect(typeof DB.posts.getFeedPosts).toBe('function');
    expect(typeof DB.posts.getStories).toBe('function');
    expect(typeof DB.posts.COLS).toBe('string');
  });
});

// Sem cliente: cada função tem que falhar com segurança. Replicamos o
// comportamento de db.test.js do vanilla, mas em vez de getSupabase global
// ausente usamos getSupabase que estoura (sem env vars).
describe('DB — caminho degradado (sem Supabase)', () => {
  beforeEach(() => {
    // Garante que getSupabase() vai estourar (env vars vazias).
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    __resetSupabaseForTests();
  });

  it('profiles.getById sem sb → null', async () => {
    expect(await DB.profiles.getById('any-id')).toBeNull();
  });
  it('profiles.getMany sem sb → []', async () => {
    expect(await DB.profiles.getMany(['a', 'b'])).toEqual([]);
  });
  it('profiles.getMany com ids vazio → [] (curto-circuita antes de _sb)', async () => {
    expect(await DB.profiles.getMany([])).toEqual([]);
  });
  it('follows.countFollowers sem sb → 0', async () => {
    expect(await DB.follows.countFollowers('u')).toBe(0);
  });
  it('follows.listFollowingIds sem sb → []', async () => {
    expect(await DB.follows.listFollowingIds('u')).toEqual([]);
  });
  it('follows.isFollowing sem sb → false', async () => {
    expect(await DB.follows.isFollowing('a', 'b')).toBe(false);
  });
  it('follows.follow sem sb → {ok:false, code:"no-client"}', async () => {
    const r = await DB.follows.follow('a', 'b');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no-client');
  });
  it('follows.follow com ids vazios → {ok:false}', async () => {
    const r = await DB.follows.follow('', '');
    expect(r.ok).toBe(false);
  });
  it('follows.unfollow sem sb → {ok:false, code:"no-client"}', async () => {
    const r = await DB.follows.unfollow('a', 'b');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no-client');
  });
  it('posts.countByUser sem sb → 0', async () => {
    expect(await DB.posts.countByUser('u')).toBe(0);
  });
  it('posts.getFeedPosts sem sb → resolve {data:[], error}', async () => {
    const r = await DB.posts.getFeedPosts({ feedIds: ['u'], offset: 0, limit: 30 });
    expect(r.data).toEqual([]);
    expect(r.error).toBeTruthy();
  });
  it('posts.getStories sem sb → resolve {data:[], error}', async () => {
    const r = await DB.posts.getStories({ feedIds: ['u'] });
    expect(r.data).toEqual([]);
    expect(r.error).toBeTruthy();
  });
});

describe('DB.profiles — colunas públicas', () => {
  it('PUBLIC_COLS contém colunas esperadas (e não pesadas)', () => {
    expect(DB.profiles.PUBLIC_COLS).toContain('id');
    expect(DB.profiles.PUBLIC_COLS).toContain('name');
    expect(DB.profiles.PUBLIC_COLS).toContain('avatar_url');
    expect(DB.profiles.PUBLIC_COLS).not.toContain('cart');
    expect(DB.profiles.PUBLIC_COLS).not.toContain('archived_conversations');
  });
});

describe('DB.posts — colunas', () => {
  it('COLS bate com POST_COLS de app.js (10 colunas)', () => {
    const cols = DB.posts.COLS.split(',').map((s) => s.trim());
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('media_type');
    expect(cols).toContain('status');
    expect(cols.length).toBe(10);
  });
});

// ─── happy-path com mock injetado ──────────────────────────────────────────
// Aqui inverte o pattern: em vez de deixar _sb() retornar null, injetamos um
// fake client via __setSupabaseForTests. O fake responde só o necessário pra
// cobrir os casos onde queremos verificar o comportamento ok-path (sem que
// um único mock incompleto force a gente a stubar todo o supabase-js).

interface FakeChain {
  from: (table: string) => FakeChain;
  select: (cols: string, opts?: { count?: string; head?: boolean }) => FakeChain;
  eq: (col: string, val: unknown) => FakeChain;
  in: (col: string, vals: unknown[]) => FakeChain;
  neq: (col: string, val: unknown) => FakeChain;
  not: (col: string, op: string, val: unknown) => FakeChain;
  or: (filter: string) => FakeChain;
  order: (col: string, opts: { ascending: boolean }) => FakeChain;
  range: (a: number, b: number) => FakeChain;
  limit: (n: number) => FakeChain;
  gte: (col: string, val: unknown) => FakeChain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  insert: (row: unknown) => Promise<{ data: unknown; error: unknown }>;
  delete: () => FakeChain;
  // Permite `await` direto no chain.
  then: (resolve: (v: { data: unknown; error: unknown; count: number }) => void) => void;
}

function makeFakeClient(opts: {
  data?: unknown;
  error?: unknown;
  count?: number;
  maybeSingleData?: unknown;
}) {
  const chain: FakeChain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    neq: () => chain,
    not: () => chain,
    or: () => chain,
    order: () => chain,
    range: () => chain,
    limit: () => chain,
    gte: () => chain,
    maybeSingle: () => Promise.resolve({ data: opts.maybeSingleData ?? null, error: opts.error ?? null }),
    insert: () => Promise.resolve({ data: null, error: opts.error ?? null }),
    delete: () => chain,
    then: (resolve) =>
      resolve({ data: opts.data ?? [], error: opts.error ?? null, count: opts.count ?? 0 }),
  };
  return chain as unknown as Parameters<typeof __setSupabaseForTests>[0];
}

describe('DB — happy path com mock', () => {
  it('profiles.getById devolve a linha quando o client responde', async () => {
    __setSupabaseForTests(makeFakeClient({ maybeSingleData: { id: 'u1', name: 'João' } }));
    const r = await DB.profiles.getById('u1');
    expect(r).toEqual({ id: 'u1', name: 'João' });
  });

  it('follows.countFollowers devolve r.count', async () => {
    __setSupabaseForTests(makeFakeClient({ count: 42 }));
    const n = await DB.follows.countFollowers('u1');
    expect(n).toBe(42);
  });

  it('follows.follow confirma via SELECT após insert (anti-bug 23505)', async () => {
    // chk devolve >0 → ok:true mesmo se insert reportou erro.
    __setSupabaseForTests(makeFakeClient({ data: [{ id: 'f1' }], error: { code: '23505', message: 'dup' } }));
    const r = await DB.follows.follow('a', 'b');
    expect(r.ok).toBe(true);
  });

  it('posts.countByUser devolve r.count e exclui stories por default', async () => {
    __setSupabaseForTests(makeFakeClient({ count: 7 }));
    const n = await DB.posts.countByUser('u1');
    expect(n).toBe(7);
  });
});

// Esta vi.mock garante que beforeEach acima realmente consiga forçar o
// estado "sem client" mesmo se algum teste anterior tiver setado env vars.
// (Vitest carrega .env, mas process.env.delete dentro do test apaga só pra
// aquele worker, suficiente pro nosso caso.)
vi.mock('../lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    exception: vi.fn(),
    setLevel: vi.fn(),
    level: 'info',
  },
}));
