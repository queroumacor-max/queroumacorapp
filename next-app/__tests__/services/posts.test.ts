// Tests de lib/services/posts.ts (composer de posts).
// Pattern alinhado com __tests__/services/leads.test.ts: injetamos um fake
// chainable do supabase-js via __setSupabaseForTests, com uma queue de
// respostas pra cobrir cadeias multi-call. Storage tem API diferente
// (.from(bucket).upload + .getPublicUrl), então o fake aceita um shape
// específico via `storage`.
//
// Cobertura (≥10 testes):
//   uploadMedia:    happy, userId vazio → AuthenticationError, file > 50MB,
//                   mime não-aceito, upload error do storage → NetworkError
//   createPost:     happy (image), userId vazio → AuthenticationError,
//                   story sem mídia → ValidationError,
//                   text-only sem caption → ValidationError,
//                   forSale sem price → ValidationError,
//                   forSale sem artType → ValidationError,
//                   erro do insert → NetworkError
//   generateCaption: happy, lista vazia → ValidationError, 503 → ConfigError,
//                   resposta vazia → ValidationError

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  uploadMedia,
  createPost,
  generateCaption,
  MAX_FILE_BYTES,
} from '../../lib/services/posts';
import {
  ValidationError,
  AuthenticationError,
  NetworkError,
  ConfigError,
} from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  storageFrom: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  getPublicUrl: ReturnType<typeof vi.fn>;
}

interface QueueItem {
  data?: unknown;
  error?: unknown;
}

interface StorageOpts {
  uploadResult?: { data?: unknown; error?: unknown };
  publicUrl?: string | null;
}

function makeFakeClient(
  queue: QueueItem[] = [],
  storageOpts: StorageOpts = {}
): { client: unknown; spies: ChainSpies } {
  const spies: ChainSpies = {
    from: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    storageFrom: vi.fn(),
    upload: vi.fn(),
    getPublicUrl: vi.fn(),
  };

  const responses = [...queue];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

  const tableChain: Record<string, unknown> = {
    insert: (row: Record<string, unknown>) => {
      spies.insert(row);
      return tableChain;
    },
    select: (cols: string) => {
      spies.select(cols);
      return tableChain;
    },
    single: () => {
      spies.single();
      const r = nextResponse();
      return Promise.resolve({
        data: r.data ?? null,
        error: r.error ?? null,
      });
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResponse();
      resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  const storageBucket = {
    upload: vi.fn(async (path: string, file: File, opts: unknown) => {
      spies.upload(path, file, opts);
      const r = storageOpts.uploadResult ?? { data: { path }, error: null };
      return r;
    }),
    getPublicUrl: vi.fn((path: string) => {
      spies.getPublicUrl(path);
      const url =
        storageOpts.publicUrl === undefined
          ? `https://test.supabase.co/storage/v1/object/public/posts/${path}`
          : storageOpts.publicUrl;
      return { data: { publicUrl: url } };
    }),
  };

  const client = {
    from: (t: string) => {
      spies.from(t);
      return tableChain;
    },
    storage: {
      from: (bucket: string) => {
        spies.storageFrom(bucket);
        return storageBucket;
      },
    },
  };

  return { client, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// File helper — `File` está disponível no Node 20+ (undici) que vitest usa.
function makeFile(
  name: string,
  type: string,
  sizeBytes: number = 1024
): File {
  // Cria um Uint8Array do tamanho pedido pra ter `size` real.
  // Evita alocar buffers gigantes pros testes de "grande demais" — só usamos
  // sizeBytes pra setar o tamanho via Blob (que respeita o byte length real).
  const bytes = new Uint8Array(Math.min(sizeBytes, 1024 * 16)); // cap em 16KB pra ser rápido
  const blob = new Blob([bytes], { type });
  // Pra simular file > MAX, sobrescrevemos `size` via Object.defineProperty
  // (Blob.size é read-only mas File herda; isso é seguro nos testes).
  const file = new File([blob], name, { type });
  if (sizeBytes > bytes.length) {
    Object.defineProperty(file, 'size', { value: sizeBytes });
  }
  return file;
}

// ─── uploadMedia ───────────────────────────────────────────────────────────

describe('uploadMedia', () => {
  it('happy path: faz upload, retorna { url, mediaType, path }', async () => {
    const { client, spies } = makeFakeClient([]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const file = makeFile('foo.jpg', 'image/jpeg', 1000);
    const out = await uploadMedia('user-1', file);
    expect(out.url).toMatch(/^https:\/\/test\.supabase\.co\/.+\.jpg$/);
    expect(out.mediaType).toBe('image');
    expect(out.path).toMatch(/^user-1\/\d+-[a-z0-9]+\.jpg$/);
    expect(spies.storageFrom).toHaveBeenCalledWith('posts');
    expect(spies.upload).toHaveBeenCalledTimes(1);
    const [path, , opts] = spies.upload.mock.calls[0];
    expect(path).toContain('user-1/');
    expect(opts).toMatchObject({ contentType: 'image/jpeg', upsert: false });
  });

  it('userId vazio → AuthenticationError (não toca storage)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const file = makeFile('x.jpg', 'image/jpeg', 100);
    await expect(uploadMedia('', file)).rejects.toBeInstanceOf(
      AuthenticationError
    );
    expect(spies.upload).not.toHaveBeenCalled();
  });

  it('file > MAX_FILE_BYTES → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const big = makeFile('big.mp4', 'video/mp4', MAX_FILE_BYTES + 1);
    await expect(uploadMedia('user-1', big)).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(spies.upload).not.toHaveBeenCalled();
  });

  it('mime não-aceito → ValidationError (não chama storage)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const weird = makeFile('foo.bmp', 'image/bmp', 100);
    await expect(uploadMedia('user-1', weird)).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(spies.upload).not.toHaveBeenCalled();
  });

  it('upload error do storage → NetworkError', async () => {
    const { client } = makeFakeClient([], {
      uploadResult: { error: { message: 'quota exceeded' } },
    });
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const file = makeFile('foo.jpg', 'image/jpeg', 100);
    await expect(uploadMedia('user-1', file)).rejects.toBeInstanceOf(
      NetworkError
    );
    await expect(uploadMedia('user-1', file)).rejects.toMatchObject({
      message: 'quota exceeded',
    });
  });

  it('publicUrl vazio do bucket → NetworkError', async () => {
    const { client } = makeFakeClient([], { publicUrl: null });
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const file = makeFile('foo.jpg', 'image/jpeg', 100);
    await expect(uploadMedia('user-1', file)).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});

// ─── createPost ────────────────────────────────────────────────────────────

describe('createPost', () => {
  it('happy path (image): insert e retorna { id, media_url }', async () => {
    const { client, spies } = makeFakeClient([
      {
        data: {
          id: 'post-1',
          media_url: 'https://test/posts/u/x.jpg',
        },
      },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await createPost({
      userId: 'u1',
      caption: 'Olha que trabalho',
      mediaUrls: ['https://test/posts/u/x.jpg'],
      mediaType: 'image',
    });
    expect(out).toEqual({
      id: 'post-1',
      media_url: 'https://test/posts/u/x.jpg',
    });
    expect(spies.from).toHaveBeenCalledWith('posts');
    expect(spies.insert).toHaveBeenCalledTimes(1);
    const row = spies.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.user_id).toBe('u1');
    expect(row.caption).toBe('Olha que trabalho');
    expect(row.media_url).toBe('https://test/posts/u/x.jpg');
    expect(row.media_type).toBe('image');
    expect(row.status).toBe('approved');
    expect(row.for_sale).toBe(false);
    expect(row.price).toBeNull();
    expect(row.art_type).toBeNull();
    expect(spies.select).toHaveBeenCalledWith('id, media_url');
    expect(spies.single).toHaveBeenCalled();
  });

  it('userId vazio → AuthenticationError (sem rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createPost({
        userId: '',
        caption: 'oi',
        mediaUrls: ['https://x'],
        mediaType: 'image',
      })
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('story sem mídia → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createPost({
        userId: 'u1',
        caption: 'só texto',
        mediaUrls: [],
        mediaType: 'story',
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('post sem mídia E sem caption → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createPost({
        userId: 'u1',
        caption: '   ',
        mediaUrls: [],
        mediaType: 'image',
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('post text-only (sem mídia, com caption) → insert OK', async () => {
    const { client, spies } = makeFakeClient([
      { data: { id: 'p2', media_url: null } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await createPost({
      userId: 'u1',
      caption: 'só texto',
      mediaUrls: [],
      mediaType: 'image',
    });
    expect(out.id).toBe('p2');
    const row = spies.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.media_url).toBeNull();
    expect(row.caption).toBe('só texto');
  });

  it('forSale=true sem price → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createPost({
        userId: 'u1',
        caption: 'venda',
        mediaUrls: ['https://x'],
        mediaType: 'image',
        forSale: true,
        artType: 'fachada',
        price: 0,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('forSale=true sem artType → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createPost({
        userId: 'u1',
        caption: 'venda',
        mediaUrls: ['https://x'],
        mediaType: 'image',
        forSale: true,
        price: 100,
        artType: '',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('forSale=true com price + artType → grava colunas de venda', async () => {
    const { client, spies } = makeFakeClient([
      { data: { id: 'p3', media_url: 'https://x' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await createPost({
      userId: 'u1',
      caption: 'venda',
      mediaUrls: ['https://x'],
      mediaType: 'image',
      forSale: true,
      price: 1500,
      artType: 'mural',
    });
    const row = spies.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.for_sale).toBe(true);
    expect(row.price).toBe(1500);
    expect(row.art_type).toBe('mural');
  });

  it('erro do insert → NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createPost({
        userId: 'u1',
        caption: 'oi',
        mediaUrls: ['https://x'],
        mediaType: 'image',
      })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('insert retorna null → NetworkError', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createPost({
        userId: 'u1',
        caption: 'oi',
        mediaUrls: ['https://x'],
        mediaType: 'image',
      })
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── generateCaption ───────────────────────────────────────────────────────

describe('generateCaption', () => {
  it('lista vazia → ValidationError', async () => {
    await expect(generateCaption([])).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: baixa imagem, chama /api/caption, retorna {caption, hashtags}', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/caption')) {
          return new Response(
            JSON.stringify({
              caption: 'Trabalho lindo!',
              hashtags: ['#pintor', '#arte'],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        // primeira chamada: baixa a imagem
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      });

    const out = await generateCaption(['https://test/posts/x.jpg']);
    expect(out.caption).toBe('Trabalho lindo!');
    expect(out.hashtags).toEqual(['#pintor', '#arte']);
    // 1 fetch pra baixar + 1 pro /api/caption
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/caption');
  });

  it('503 do backend → ConfigError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/caption')) {
          return new Response(
            JSON.stringify({ error: 'sem OPENAI_API_KEY' }),
            { status: 503 }
          );
        }
        return new Response(new Uint8Array([1]), { status: 200 });
      }
    );
    await expect(
      generateCaption(['https://test/posts/x.jpg'])
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('resposta sem caption nem hashtags → ValidationError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/caption')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(new Uint8Array([1]), { status: 200 });
      }
    );
    await expect(
      generateCaption(['https://test/posts/x.jpg'])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('erro de rede no fetch da imagem → NetworkError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('network failure');
    });
    await expect(
      generateCaption(['https://test/posts/x.jpg'])
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('500 do /api/caption → NetworkError com message do backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/caption')) {
          return new Response(JSON.stringify({ error: 'boom' }), {
            status: 500,
          });
        }
        return new Response(new Uint8Array([1]), { status: 200 });
      }
    );
    await expect(
      generateCaption(['https://test/posts/x.jpg'])
    ).rejects.toMatchObject({ name: 'NetworkError', message: 'boom' });
  });
});
