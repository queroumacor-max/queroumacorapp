// Tests do service lib/services/aiLogo.ts.
// Pattern: fetch é mockado pra generateLogos (HTTP); supabase chainable
// (mesmo padrão de profile.test.ts) pra saveLogo/fetchLogo/uploadLogo.
//
// Cobertura (10 testes):
//   - generateLogos: name vazio → ValidationError; HTTP 200 happy →
//     retorna urls; HTTP 401 com error body → NetworkError com message;
//     resposta sem urls → NetworkError; fetch rejeita → NetworkError.
//   - saveLogo: userId vazio → ValidationError; happy → update + filtro;
//     erro supabase → NetworkError.
//   - fetchLogo: happy → retorna URL; data null → null.
//   - uploadLogo: arquivo não-imagem → ValidationError.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  generateLogos,
  saveLogo,
  fetchLogo,
  uploadLogo,
} from '../../lib/services/aiLogo';
import { NetworkError, ValidationError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────
// Mesmo padrão de profile.test.ts — chain devolve queue de respostas; storage
// devolve por bucket. Suporta `.from().select().eq().maybeSingle()`,
// `.from().update().eq()`, e `.storage.from().upload()/getPublicUrl()`.

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  storageFrom: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  getPublicUrl: ReturnType<typeof vi.fn>;
}

interface QueueItem {
  data?: unknown;
  error?: unknown;
}

interface StorageResp {
  uploadError?: unknown;
  publicUrl?: string;
}

interface FakeOpts {
  queue?: QueueItem[];
  storage?: Record<string, StorageResp>;
}

function makeFakeClient(opts: FakeOpts = {}): {
  client: unknown;
  spies: ChainSpies;
} {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(),
    storageFrom: vi.fn(),
    upload: vi.fn(),
    getPublicUrl: vi.fn(),
  };

  const responses = [...(opts.queue ?? [])];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

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
    update: (patch: Record<string, unknown>) => {
      spies.update(patch);
      return chain;
    },
    maybeSingle: () => {
      spies.maybeSingle();
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResponse();
      resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  const storageBuckets = opts.storage ?? {};
  const storage = {
    from: (bucket: string) => {
      spies.storageFrom(bucket);
      const resp = storageBuckets[bucket] ?? {};
      return {
        upload: (path: string, file: File, options?: unknown) => {
          spies.upload(bucket, path, file, options);
          return Promise.resolve({
            data: resp.uploadError ? null : { path },
            error: resp.uploadError ?? null,
          });
        },
        getPublicUrl: (path: string) => {
          spies.getPublicUrl(bucket, path);
          return { data: { publicUrl: resp.publicUrl ?? '' } };
        },
      };
    },
  };

  (chain as Record<string, unknown>).storage = storage;

  return { client: chain, spies };
}

// Helper: cria File "fake" (Node 20+ tem File constructor via undici).
function makeFile(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

// ─── fetch mock helpers ────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

// Aceita um JSON body + status, ou um Error pra simular falha de rede.
// Importante: cada call do fetch precisa devolver um Response NOVO porque
// Response.json() só pode ser consumido uma vez (e alguns testes assertam
// duas vezes — `rejects.toBeInstanceOf` + `rejects.toMatchObject`).
function mockFetchJSON(body: unknown, status = 200): void {
  if (fetchSpy) fetchSpy.mockRestore();
  fetchSpy = vi.spyOn(globalThis, 'fetch') as unknown as ReturnType<
    typeof vi.spyOn
  >;
  (
    fetchSpy as unknown as {
      mockImplementation: (fn: () => Promise<Response>) => void;
    }
  ).mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

function mockFetchError(error: Error): void {
  if (fetchSpy) fetchSpy.mockRestore();
  fetchSpy = vi.spyOn(globalThis, 'fetch') as unknown as ReturnType<
    typeof vi.spyOn
  >;
  (
    fetchSpy as unknown as { mockRejectedValue: (e: Error) => void }
  ).mockRejectedValue(error);
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
  fetchSpy = null;
});

afterEach(() => {
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
});

// ─── generateLogos ─────────────────────────────────────────────────────────

describe('generateLogos', () => {
  it('name vazio → ValidationError (sem bater na rede)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(generateLogos({ name: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('happy path: posta JSON com name/style/slogan e retorna urls', async () => {
    const urls = [
      'https://cdn/logo1.png',
      'https://cdn/logo2.png',
      'https://cdn/logo3.png',
      'https://cdn/logo4.png',
    ];
    mockFetchJSON({ urls });
    const out = await generateLogos({
      name: 'Cali Colors',
      slogan: 'cores que vivem',
      style: 'flat',
    });
    expect(out).toEqual(urls);

    // Verifica payload do POST.
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/generate-logo',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
    const call = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    const init = call[1] as { body: string };
    const parsed = JSON.parse(init.body) as {
      name: string;
      slogan?: string;
      style?: string;
    };
    expect(parsed.name).toBe('Cali Colors');
    expect(parsed.slogan).toBe('cores que vivem');
    expect(parsed.style).toBe('flat');
  });

  it('HTTP 401 com error body → NetworkError com a message do backend', async () => {
    mockFetchJSON({ error: 'PRO only' }, 401);
    await expect(generateLogos({ name: 'Foo' })).rejects.toBeInstanceOf(
      NetworkError,
    );
    await expect(generateLogos({ name: 'Foo' })).rejects.toMatchObject({
      message: 'PRO only',
    });
  });

  it('resposta 200 sem urls → NetworkError', async () => {
    mockFetchJSON({ urls: [] });
    await expect(generateLogos({ name: 'Foo' })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('fetch rejeita (rede caiu) → NetworkError', async () => {
    mockFetchError(new Error('network down'));
    await expect(generateLogos({ name: 'Foo' })).rejects.toBeInstanceOf(
      NetworkError,
    );
    await expect(generateLogos({ name: 'Foo' })).rejects.toMatchObject({
      message: 'Falha de rede ao gerar logo',
    });
  });
});

// ─── saveLogo ──────────────────────────────────────────────────────────────

describe('saveLogo', () => {
  it('userId vazio → ValidationError (não toca no supabase)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0],
    );
    await expect(saveLogo('', 'https://cdn/x.png')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: update business_logo_url + filtro por id', async () => {
    const { client, spies } = makeFakeClient({ queue: [{ data: null }] });
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0],
    );
    await saveLogo('u1', 'https://cdn/logo.png');
    expect(spies.from).toHaveBeenCalledWith('profiles');
    const updateCall = spies.update.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(updateCall.business_logo_url).toBe('https://cdn/logo.png');
    expect(spies.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('erro supabase (RLS) → NetworkError', async () => {
    const { client } = makeFakeClient({
      queue: [{ data: null, error: { message: 'rls denied' } }],
    });
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0],
    );
    await expect(
      saveLogo('u1', 'https://cdn/logo.png'),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── fetchLogo ─────────────────────────────────────────────────────────────

describe('fetchLogo', () => {
  it('happy path: retorna URL do business_logo_url', async () => {
    const { client, spies } = makeFakeClient({
      queue: [{ data: { business_logo_url: 'https://cdn/logo.png' } }],
    });
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0],
    );
    const out = await fetchLogo('u1');
    expect(out).toBe('https://cdn/logo.png');
    expect(spies.from).toHaveBeenCalledWith('profiles');
    expect(spies.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('data null ou sem business_logo_url → null', async () => {
    const { client } = makeFakeClient({ queue: [{ data: null }] });
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0],
    );
    const out = await fetchLogo('u1');
    expect(out).toBeNull();
  });
});

// ─── uploadLogo ────────────────────────────────────────────────────────────

describe('uploadLogo', () => {
  it('arquivo não-imagem → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0],
    );
    const f = makeFile('doc.pdf', 'application/pdf', 100);
    await expect(uploadLogo('u1', f)).rejects.toBeInstanceOf(ValidationError);
  });
});
