// Tests do service lib/services/feed.ts.
// Estrutura: fake supabase chainable que roteia respostas POR TABELA
// (posts/profiles/profiles_public/comments/likes/saved_posts/follows) em vez
// do queue linear dos outros services — fetchFeed dispara várias queries em
// paralelo, então ordem de await não é determinística. Roteamento por tabela
// garante asserções estáveis.
//
// Cobertura (12 testes):
//   1. fetchPublicProfiles: ids vazio → [] sem rede;
//   2. fetchPublicProfiles: happy path (delega pra DB.profiles.getMany);
//   3. fetchFeed: posts vazio → [] (não dispara wave B);
//   4. fetchFeed: error no fetch principal → NetworkError;
//   5. fetchFeed: happy path enriquece com profile + liked + saved + likeCount;
//   6. fetchFeed: likeCount agrega corretamente várias linhas;
//   7. fetchFeed: comments são bucketizados por post_id;
//   8. fetchFeed: sem user → não consulta likes/saved (pula my-likes/saved);
//   9. fetchFeed: roleFilter aplica filtro post-fetch;
//  10. fetchFeed: offset/limit propagados pra DB.posts.getFeedPosts;
//  11. fetchFeed: followingOnly=true usa lista de follows + próprio user;
//  12. fetchFeed: post sem perfil resolvido recebe fallback graceful.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import { fetchFeed, fetchPublicProfiles } from '../../lib/services/feed';
import { NetworkError } from '../../lib/errors';

// ─── fake supabase chainable router ────────────────────────────────────────
// Cada query começa com .from(table) — guardamos a tabela e devolvemos um
// chainable que, no await final (then), procura a resposta no map por tabela.
// `range` é coberto pra suportar getFeedPosts (que chama .range(off,off+lim)).

interface TableResp {
  data?: unknown;
  error?: unknown;
}

interface Spies {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  // last `in` por tabela pra asserções como "likes consultou esses post_ids".
  insByTable: Record<string, Array<{ col: string; vals: unknown[] }>>;
  eqsByTable: Record<string, Array<{ col: string; val: unknown }>>;
  rangeByTable: Record<string, Array<{ from: number; to: number }>>;
}

function makeFakeClient(byTable: Record<string, TableResp>): {
  client: unknown;
  spies: Spies;
} {
  const spies: Spies = {
    fromCalls: [],
    selects: [],
    insByTable: {},
    eqsByTable: {},
    rangeByTable: {},
  };

  function makeChain(table: string) {
    const chain: Record<string, unknown> = {};
    chain.select = (cols: string) => {
      spies.selects.push({ table, cols });
      return chain;
    };
    chain.eq = (col: string, val: unknown) => {
      (spies.eqsByTable[table] ??= []).push({ col, val });
      return chain;
    };
    chain.neq = (_col: string, _val: unknown) => chain;
    chain.or = (_expr: string) => chain;
    chain.not = (_col: string, _op: string, _val: unknown) => chain;
    chain.gte = (_col: string, _val: unknown) => chain;
    chain.in = (col: string, vals: unknown[]) => {
      (spies.insByTable[table] ??= []).push({ col, vals });
      return chain;
    };
    chain.order = (_col: string, _opts: { ascending: boolean }) => chain;
    chain.limit = (_n: number) => chain;
    chain.range = (from: number, to: number) => {
      (spies.rangeByTable[table] ??= []).push({ from, to });
      return chain;
    };
    // await na chain — devolve { data, error } da tabela. Se não setado,
    // assume sem erro e sem data (degradação graciosa, igual ao service).
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = byTable[table] ?? {};
      resolve({ data: r.data ?? null, error: r.error ?? null });
    };
    return chain;
  }

  const client = {
    from: (table: string) => {
      spies.fromCalls.push(table);
      return makeChain(table);
    },
  };
  return { client, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchPublicProfiles ──────────────────────────────────────────────────

describe('fetchPublicProfiles', () => {
  it('ids vazio → [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient({});
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchPublicProfiles([]);
    expect(out).toEqual([]);
    expect(spies.fromCalls).toHaveLength(0);
  });

  it('happy path: delega pra view profiles_public e retorna rows', async () => {
    const rows = [
      { id: 'a', name: 'Alice', tag: 'alice', avatar_url: null, role: 'pintor' },
      { id: 'b', name: 'Bob', tag: 'bob', avatar_url: null, role: 'grafiteiro' },
    ];
    const { client, spies } = makeFakeClient({
      profiles_public: { data: rows },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchPublicProfiles(['a', 'b']);
    expect(out).toEqual(rows);
    expect(spies.fromCalls).toContain('profiles_public');
  });
});

// ─── fetchFeed ────────────────────────────────────────────────────────────

describe('fetchFeed', () => {
  it('posts vazio → [] e não dispara wave B (comments/likes/saved)', async () => {
    const { client, spies } = makeFakeClient({
      posts: { data: [] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFeed({ userId: 'u1' });
    expect(out).toEqual([]);
    // Não deve ter tocado em likes/saved/comments porque saiu cedo.
    expect(spies.fromCalls).not.toContain('likes');
    expect(spies.fromCalls).not.toContain('saved_posts');
    expect(spies.fromCalls).not.toContain('comments');
  });

  it('error no fetch principal → joga NetworkError', async () => {
    const { client } = makeFakeClient({
      posts: { data: null, error: { message: 'db down' } },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchFeed({ userId: 'u1' })).rejects.toBeInstanceOf(NetworkError);
    await expect(fetchFeed({ userId: 'u1' })).rejects.toMatchObject({
      message: 'db down',
    });
  });

  it('happy path: enriquece posts com profile + liked + saved + likeCount', async () => {
    const posts = [
      { id: 'p1', user_id: 'a', caption: 'hi', media_url: 'x.jpg', created_at: '2026-05-31T10:00:00Z' },
    ];
    const { client } = makeFakeClient({
      posts: { data: posts },
      profiles_public: {
        data: [{ id: 'a', name: 'Alice', tag: 'alice', role: 'pintor' }],
      },
      likes: { data: [{ post_id: 'p1' }, { post_id: 'p1' }] }, // 2 likes total
      saved_posts: { data: [{ post_id: 'p1' }] },
      comments: { data: [] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFeed({ userId: 'a' });
    expect(out).toHaveLength(1);
    const post = out[0]!;
    expect(post.id).toBe('p1');
    expect(post.profile.name).toBe('Alice');
    // myLikes e allLikes consultam a MESMA tabela `likes` — o router devolve
    // a mesma data pros dois (2 rows). Então liked=true (post_id in mySet) E
    // likeCount=2 (allLikes contou 2 rows).
    expect(post.liked).toBe(true);
    expect(post.likeCount).toBe(2);
    expect(post.saved).toBe(true);
    expect(post.comments).toEqual([]);
  });

  it('likeCount agrega contando linhas duplicadas do mesmo post_id', async () => {
    const posts = [
      { id: 'p1', user_id: 'a', created_at: '2026-05-31T10:00:00Z' },
      { id: 'p2', user_id: 'a', created_at: '2026-05-31T11:00:00Z' },
    ];
    const { client } = makeFakeClient({
      posts: { data: posts },
      profiles_public: { data: [{ id: 'a', name: 'Alice' }] },
      // 3 likes em p1, 1 like em p2 — agregado deve refletir.
      likes: {
        data: [
          { post_id: 'p1' },
          { post_id: 'p1' },
          { post_id: 'p1' },
          { post_id: 'p2' },
        ],
      },
      saved_posts: { data: [] },
      comments: { data: [] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFeed({ userId: 'someone-else' });
    const map = new Map(out.map((p) => [p.id, p.likeCount]));
    expect(map.get('p1')).toBe(3);
    expect(map.get('p2')).toBe(1);
  });

  it('comments são bucketizados por post_id', async () => {
    const posts = [
      { id: 'p1', user_id: 'a', created_at: '2026-05-31T10:00:00Z' },
      { id: 'p2', user_id: 'a', created_at: '2026-05-31T11:00:00Z' },
    ];
    const comments = [
      { id: 'c1', post_id: 'p1', user_id: 'b', text: 'top', created_at: '2026-05-31T10:01:00Z' },
      { id: 'c2', post_id: 'p1', user_id: 'b', text: 'demais', created_at: '2026-05-31T10:02:00Z' },
      { id: 'c3', post_id: 'p2', user_id: 'b', text: 'curti', created_at: '2026-05-31T11:01:00Z' },
    ];
    const { client } = makeFakeClient({
      posts: { data: posts },
      profiles_public: { data: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
      likes: { data: [] },
      saved_posts: { data: [] },
      comments: { data: comments },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFeed({ userId: 'u1' });
    const p1 = out.find((p) => p.id === 'p1');
    const p2 = out.find((p) => p.id === 'p2');
    expect(p1?.comments).toHaveLength(2);
    expect(p1?.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(p2?.comments).toHaveLength(1);
    expect(p2?.comments[0]?.text).toBe('curti');
  });

  it('sem userId → não consulta my-likes nem saved (pula ramo logado)', async () => {
    const posts = [{ id: 'p1', user_id: 'a', created_at: '2026-05-31T10:00:00Z' }];
    const { client, spies } = makeFakeClient({
      posts: { data: posts },
      profiles_public: { data: [{ id: 'a', name: 'A' }] },
      // likes e saved_posts NÃO setados aqui — o teste valida que não foram
      // chamados. Mesmo assim configuramos `likes` vazio porque allLikes
      // (não autenticado-dependente) consulta sem filtro de user.
      likes: { data: [] },
      comments: { data: [] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFeed({ userId: null });
    // saved_posts não deve ter sido tocado (só logado consulta).
    expect(spies.fromCalls).not.toContain('saved_posts');
    expect(out).toHaveLength(1);
    expect(out[0]?.liked).toBe(false);
    expect(out[0]?.saved).toBe(false);
  });

  it('roleFilter aplica filtro post-fetch (autores com role diferente saem)', async () => {
    const posts = [
      { id: 'p1', user_id: 'a', created_at: '2026-05-31T10:00:00Z' },
      { id: 'p2', user_id: 'b', created_at: '2026-05-31T11:00:00Z' },
    ];
    const { client } = makeFakeClient({
      posts: { data: posts },
      profiles_public: {
        data: [
          { id: 'a', name: 'A', role: 'pintor' },
          { id: 'b', name: 'B', role: 'grafiteiro' },
        ],
      },
      likes: { data: [] },
      saved_posts: { data: [] },
      comments: { data: [] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFeed({ userId: 'u1', roleFilter: 'pintor' });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('p1');
    expect(out[0]?.profile.role).toBe('pintor');
  });

  it('offset/limit propagados pra range() na tabela posts', async () => {
    const { client, spies } = makeFakeClient({
      posts: { data: [] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await fetchFeed({ userId: 'u1', offset: 30, limit: 10 });
    // range(offset, offset+limit-1) → (30, 39)
    expect(spies.rangeByTable.posts).toEqual([{ from: 30, to: 39 }]);
  });

  it('followingOnly=true consulta follows + inclui o próprio user no feedIds', async () => {
    const { client, spies } = makeFakeClient({
      posts: { data: [] },
      follows: { data: [{ following_id: 'friend1' }, { following_id: 'friend2' }] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await fetchFeed({ userId: 'me', followingOnly: true });
    expect(spies.fromCalls).toContain('follows');
    // posts.in('user_id', [...]) deve ter incluído friend1, friend2 E 'me'.
    const postsIn = spies.insByTable.posts;
    expect(postsIn).toBeDefined();
    const passedIds = postsIn?.[0]?.vals as string[];
    expect(passedIds).toEqual(expect.arrayContaining(['friend1', 'friend2', 'me']));
  });

  it('post sem profile resolvido recebe fallback (id-only profile)', async () => {
    const posts = [{ id: 'p1', user_id: 'ghost', created_at: '2026-05-31T10:00:00Z' }];
    const { client } = makeFakeClient({
      posts: { data: posts },
      // Tanto profiles_public quanto profiles vazios — autor foi deletado.
      profiles_public: { data: [] },
      profiles: { data: [] },
      likes: { data: [] },
      saved_posts: { data: [] },
      comments: { data: [] },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFeed({ userId: 'me' });
    expect(out).toHaveLength(1);
    // Fallback graceful — profile vazio mas com id pra UI não estourar.
    expect(out[0]?.profile.id).toBe('ghost');
    expect(out[0]?.profile.name).toBeUndefined();
  });
});
