// Tests do service lib/services/stories.ts.
// Pattern: fake supabase chainable com queue de respostas (mesmo padrão do
// archive.test.ts), mais um mock pra `storage` que cobre upload + getPublicUrl.
//
// As funções deste service fazem múltiplas calls em sequência:
//   - fetchStoriesGroupedByUser: 3 queries (stories, profiles, seen_stories)
//   - markStorySeen: 2 queries (read seen_stories + update)
//   - uploadStory: storage.upload + getPublicUrl + insert into posts
//
// Cobertura (>= 10 tests):
//   - fetchStoriesGroupedByUser × 5 (vazio, error, agrupa+ordena, seen flag,
//     own first)
//   - markStorySeen × 3 (validation, happy path, error)
//   - uploadStory × 4 (validation × 2, happy path, error)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchStoriesGroupedByUser,
  markStorySeen,
  uploadStory,
} from '../../lib/services/stories';
import { NetworkError, ValidationError } from '../../lib/errors';

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  getPublicUrl: ReturnType<typeof vi.fn>;
  storageFrom: ReturnType<typeof vi.fn>;
}

interface QueueItem {
  data?: unknown;
  error?: unknown;
}

interface StorageItem {
  uploadError?: unknown;
  publicUrl?: string | null;
}

function makeFakeClient(
  queue: QueueItem[] = [],
  storageQueue: StorageItem[] = [],
): { client: unknown; spies: ChainSpies } {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    upload: vi.fn(),
    getPublicUrl: vi.fn(),
    storageFrom: vi.fn(),
  };

  const responses = [...queue];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

  const storageResponses = [...storageQueue];
  function nextStorage(): StorageItem {
    return storageResponses.shift() ?? { publicUrl: 'https://x/pub' };
  }

  // Chain genérico: cada terminator (`.limit`, `.maybeSingle`, `.single`,
  // `.insert().select().single()`) consome um item da queue.
  const chain: Record<string, unknown> = {
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
    in: (col: string, vals: unknown) => {
      spies.in(col, vals);
      return chain;
    },
    gte: (col: string, val: unknown) => {
      spies.gte(col, val);
      return chain;
    },
    not: (col: string, op: string, val: unknown) => {
      spies.not(col, op, val);
      return chain;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      spies.order(col, opts);
      return chain;
    },
    // .limit() é terminator do path stories — consome queue item.
    limit: (n: number) => {
      spies.limit(n);
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    update: (patch: Record<string, unknown>) => {
      spies.update(patch);
      return chain;
    },
    insert: (row: Record<string, unknown>) => {
      spies.insert(row);
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
    // path do .in (profiles) sem terminator — usa thenable; mas o service
    // chama `.select(...).in(...)` (sem .single), então o await direto no
    // builder resolve via `then` aqui.
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResponse();
      resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  const storage = {
    from: (bucket: string) => {
      spies.storageFrom(bucket);
      return {
        upload: (
          path: string,
          file: unknown,
          opts: Record<string, unknown>,
        ) => {
          spies.upload(path, file, opts);
          const s = nextStorage();
          return Promise.resolve({
            data: s.uploadError ? null : { path },
            error: s.uploadError ?? null,
          });
        },
        getPublicUrl: (path: string) => {
          spies.getPublicUrl(path);
          // getPublicUrl é sync no supabase-js; reusa o mesmo storage item
          // se o caller já chamou upload (peek atrás de array — defensivo:
          // usa o último publicUrl conhecido).
          const last = storageQueue[storageQueue.length - 1];
          const url =
            last?.publicUrl !== undefined ? last.publicUrl : 'https://x/pub';
          return { data: url ? { publicUrl: url } : { publicUrl: '' } };
        },
      };
    },
  };

  return {
    client: { ...chain, storage } as unknown,
    spies,
  };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchStoriesGroupedByUser ─────────────────────────────────────────────

describe('fetchStoriesGroupedByUser', () => {
  it('viewerId vazio → [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchStoriesGroupedByUser('', ['u2']);
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('sem follows nem viewer válido → retorna [] (early return)', async () => {
    // Service mudou: rows=[] NÃO faz early return — quando tem followingIds,
    // renderiza bolinhas cinzas pra cada follow sem story (modules/stories.js
    // linha 154+). Só early-returna quando viewerId vazio ou feedIds vazio.
    const { client, spies } = makeFakeClient([]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchStoriesGroupedByUser('', []);
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rows vazio mas com follows → retorna bolinhas cinzas dos follows', async () => {
    // queue: stories=[], profiles=[{u2 profile}], seen=null.
    const u2Prof = { id: 'u2', name: 'User 2', tag: 'u2tag', avatar_url: null };
    const { client } = makeFakeClient([
      { data: [] },           // stories
      { data: [u2Prof] },     // profiles
      { data: null },         // seen_stories maybeSingle
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchStoriesGroupedByUser('u1', ['u2']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ user_id: 'u2', stories: [], seen: true });
  });

  it('error no fetch de stories → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'boom' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      fetchStoriesGroupedByUser('u1', ['u2']),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('agrupa por user_id e retorna grupos com profiles+seen flag', async () => {
    // Queue: stories (2 stories pra u2), profiles (1 profile pra u2),
    // seen_stories (maybeSingle — vazio).
    const story1 = {
      id: 's1',
      user_id: 'u2',
      media_url: 'https://x/1.jpg',
      media_type: 'story',
      created_at: '2026-05-31T10:00:00Z',
    };
    const story2 = {
      id: 's2',
      user_id: 'u2',
      media_url: 'https://x/2.jpg',
      media_type: 'story',
      created_at: '2026-05-31T11:00:00Z',
    };
    const profileU2 = {
      id: 'u2',
      name: 'Bob',
      tag: 'bob',
      avatar_url: null,
    };
    const { client } = makeFakeClient([
      { data: [story1, story2] }, // stories
      { data: [profileU2] }, // profiles
      { data: { seen_stories: {} } }, // seen_stories maybeSingle
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchStoriesGroupedByUser('u1', ['u2']);
    expect(out).toHaveLength(1);
    expect(out[0]!.user_id).toBe('u2');
    expect(out[0]!.profile.tag).toBe('bob');
    expect(out[0]!.stories).toHaveLength(2);
    expect(out[0]!.seen).toBe(false); // seen_stories vazio → unseen
    expect(out[0]!.isOwn).toBe(false);
  });

  it('marca grupo como seen quando seen_stories[uid] >= created_at do último story', async () => {
    const lastStoryCreated = '2026-05-31T11:00:00Z';
    const story = {
      id: 's1',
      user_id: 'u2',
      media_url: 'https://x/1.jpg',
      media_type: 'story',
      created_at: lastStoryCreated,
    };
    const seenTs = Date.parse(lastStoryCreated) + 1000; // 1s depois
    const { client } = makeFakeClient([
      { data: [story] },
      { data: [{ id: 'u2', name: 'B', tag: null, avatar_url: null }] },
      { data: { seen_stories: { u2: seenTs } } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchStoriesGroupedByUser('u1', ['u2']);
    expect(out).toHaveLength(1);
    expect(out[0]!.seen).toBe(true);
  });

  it('ordem: own → unseen → seen', async () => {
    // 3 stories: own (u1), seen (u2), unseen (u3).
    const sOwn = {
      id: 'so',
      user_id: 'u1',
      media_url: 'https://x/o.jpg',
      media_type: 'story',
      created_at: '2026-05-31T12:00:00Z',
    };
    const sSeen = {
      id: 'ss',
      user_id: 'u2',
      media_url: 'https://x/s.jpg',
      media_type: 'story',
      created_at: '2026-05-31T10:00:00Z',
    };
    const sUnseen = {
      id: 'su',
      user_id: 'u3',
      media_url: 'https://x/u.jpg',
      media_type: 'story',
      created_at: '2026-05-31T11:00:00Z',
    };
    const seenTs = Date.parse(sSeen.created_at) + 1000;
    const { client } = makeFakeClient([
      { data: [sSeen, sUnseen, sOwn] },
      {
        data: [
          { id: 'u1', name: 'Me', tag: null, avatar_url: null },
          { id: 'u2', name: 'B', tag: null, avatar_url: null },
          { id: 'u3', name: 'C', tag: null, avatar_url: null },
        ],
      },
      { data: { seen_stories: { u2: seenTs } } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchStoriesGroupedByUser('u1', ['u2', 'u3']);
    expect(out).toHaveLength(3);
    expect(out[0]!.user_id).toBe('u1'); // own first
    expect(out[0]!.isOwn).toBe(true);
    expect(out[1]!.user_id).toBe('u3'); // unseen
    expect(out[1]!.seen).toBe(false);
    expect(out[2]!.user_id).toBe('u2'); // seen last
    expect(out[2]!.seen).toBe(true);
  });
});

// ─── markStorySeen ─────────────────────────────────────────────────────────

describe('markStorySeen', () => {
  it('viewerId vazio → ValidationError sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(markStorySeen('', 'u2')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: lê seen_stories, faz merge e update', async () => {
    const existing = { u9: 12345 };
    const { client, spies } = makeFakeClient([
      { data: { seen_stories: existing } }, // read
      { data: null }, // update
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const before = Date.now();
    await markStorySeen('u1', 'u2', 's1');
    expect(spies.update).toHaveBeenCalledTimes(1);
    const updatePatch = spies.update.mock.calls[0]![0] as {
      seen_stories: Record<string, number>;
    };
    // Mantém entry antiga + adiciona nova com timestamp recente.
    expect(updatePatch.seen_stories.u9).toBe(12345);
    expect(updatePatch.seen_stories.u2).toBeGreaterThanOrEqual(before);
  });

  it('error no update → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: { seen_stories: {} } },
      { data: null, error: { message: 'rls update' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(markStorySeen('u1', 'u2')).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

// ─── uploadStory ───────────────────────────────────────────────────────────

describe('uploadStory', () => {
  // Cria um File fake (jsdom-friendly via objeto literal pra evitar
  // dependency em File constructor).
  function fakeFile(name = 'a.jpg', type = 'image/jpeg', size = 1024): File {
    return {
      name,
      type,
      size,
      lastModified: Date.now(),
      // Métodos não-usados pelo service; deixo como any pra cumprir File type.
    } as unknown as File;
  }

  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient([]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(uploadStory('', fakeFile(), 'image')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('mediaType inválido → ValidationError', async () => {
    const { client } = makeFakeClient([]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      // @ts-expect-error testando guard de runtime
      uploadStory('u1', fakeFile(), 'audio'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: upload + insert retorna id do post', async () => {
    const { client, spies } = makeFakeClient(
      // queue: insert → select → single → {id:'p1'}
      [{ data: { id: 'p1' } }],
      [{ publicUrl: 'https://cdn/x.jpg' }],
    );
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const id = await uploadStory('u1', fakeFile('foto.jpg'), 'image');
    expect(id).toBe('p1');
    expect(spies.storageFrom).toHaveBeenCalledWith('posts');
    expect(spies.upload).toHaveBeenCalled();
    expect(spies.from).toHaveBeenCalledWith('posts');
    // Insert deve marcar media_type='story' (campo crítico pro feed filtrar).
    const insertedRow = spies.insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedRow.media_type).toBe('story');
    expect(insertedRow.user_id).toBe('u1');
    expect(insertedRow.media_url).toBe('https://cdn/x.jpg');
  });

  it('storage upload error → joga NetworkError', async () => {
    const { client } = makeFakeClient(
      [],
      [{ uploadError: { message: 'bucket full' } }],
    );
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      uploadStory('u1', fakeFile(), 'image'),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
