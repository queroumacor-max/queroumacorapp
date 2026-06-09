// Tests do service lib/services/profile.ts.
// Pattern alinhado com __tests__/services/leads.test.ts: queue de respostas
// pro chainable supabase + spies em from/select/eq/update/maybeSingle pra
// asserções de "qual tabela, que coluna, que valor". Storage e fetch (cidades)
// têm fakes próprios porque não passam pelo chainable.
//
// Cobertura:
//   - getProfile: userId vazio → null, happy path, data null → null,
//     erro Supabase → NetworkError.
//   - updateProfile: userId vazio → ValidationError, normaliza tag/state,
//     erro Supabase → NetworkError.
//   - uploadAvatar: file inválido → ValidationError, file maior que 5MB →
//     ValidationError, happy (bucket avatars), fallback pra posts, ambos
//     falham → NetworkError.
//   - getCidadesByUF: UF inválida → [], happy (parse retorno IBGE), fetch
//     erro → [].
//   - getEspecialidadesByRole: pintor/grafiteiro/automotivo retornam arrays,
//     cliente/admin/null retornam [].

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  getProfile,
  updateProfile,
  uploadAvatar,
  getCidadesByUF,
  getEspecialidadesByRole,
  ROLE_SPECS,
} from '../../lib/services/profile';
import { NetworkError, ValidationError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────

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
  // Map por bucket (avatars/posts) das respostas do storage.upload.
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
    // maybeSingle retorna a próxima resposta direto (não chainable).
    maybeSingle: () => {
      spies.maybeSingle();
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    // await na chain inteira (update sem maybeSingle).
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

  return {
    client: chain,
    spies,
  };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── getProfile ────────────────────────────────────────────────────────────

describe('getProfile', () => {
  it('userId vazio → resolve null sem bater na rede', async () => {
    const { client, spies } = makeFakeClient({ queue: [{ data: { id: 'x' } }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getProfile('');
    expect(out).toBeNull();
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna profile + usa filtros corretos', async () => {
    const profile = {
      id: 'u1',
      name: 'Fulano',
      tag: 'fulano',
      email: 'a@b.com',
      city: 'São Paulo',
      state: 'SP',
      role: 'pintor',
    };
    const { client, spies } = makeFakeClient({ queue: [{ data: profile }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await getProfile('u1');
    expect(out).toEqual(profile);
    expect(spies.from).toHaveBeenCalledWith('profiles');
    expect(spies.eq).toHaveBeenCalledWith('id', 'u1');
    expect(spies.maybeSingle).toHaveBeenCalled();
  });

  it('data null → resolve null (não throws)', async () => {
    const { client } = makeFakeClient({ queue: [{ data: null }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getProfile('u1');
    expect(out).toBeNull();
  });

  it('error path → joga NetworkError com message do supabase', async () => {
    // 2 expects = 2 calls de getProfile; cada uma faz select em profiles +
    // fallback em profiles_public quando profiles erra. 4 respostas total.
    const err = { data: null, error: { message: 'rls bloqueou' } };
    const { client } = makeFakeClient({ queue: [err, err, err, err] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(getProfile('u1')).rejects.toBeInstanceOf(NetworkError);
    await expect(getProfile('u1')).rejects.toMatchObject({
      message: 'rls bloqueou',
    });
  });
});

// ─── updateProfile ─────────────────────────────────────────────────────────

describe('updateProfile', () => {
  it('userId vazio → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(updateProfile('', { name: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: aplica update + filtra por id + normaliza tag/state', async () => {
    const { client, spies } = makeFakeClient({ queue: [{ data: null }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    await updateProfile('u1', {
      name: 'Fulano',
      tag: '@FULANO ',
      state: 'sp',
      phone: '5511999999999',
    });

    expect(spies.from).toHaveBeenCalledWith('profiles');
    expect(spies.eq).toHaveBeenCalledWith('id', 'u1');
    // Garante normalização aplicada (lowercase/sem @ no tag, uppercase no state).
    const updateCall = spies.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall.tag).toBe('fulano');
    expect(updateCall.state).toBe('SP');
    expect(updateCall.name).toBe('Fulano');
    // `updated_at` foi removido — coluna não existe em `profiles` no schema
    // (supabase_init.sql). O vanilla setava como no-op silencioso; o typed
    // client agora rejeita. Garante que NÃO está mais sendo enviado.
    expect(updateCall.updated_at).toBeUndefined();
  });

  it('error path → joga NetworkError', async () => {
    const { client } = makeFakeClient({
      queue: [{ data: null, error: { message: 'fk violation' } }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      updateProfile('u1', { name: 'x' }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── uploadAvatar ──────────────────────────────────────────────────────────

// Helper: cria um File "fake" (em jsdom-less env precisamos polyfill mínimo).
function makeFile(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  // File constructor existe em Node 20+ (undici). Cast pra File.
  return new File([blob], name, { type });
}

describe('uploadAvatar', () => {
  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('a.jpg', 'image/jpeg', 100);
    await expect(uploadAvatar('', f)).rejects.toBeInstanceOf(ValidationError);
  });

  it('file não-imagem → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('doc.pdf', 'application/pdf', 100);
    await expect(uploadAvatar('u1', f)).rejects.toBeInstanceOf(ValidationError);
  });

  it('file > 5MB → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024);
    await expect(uploadAvatar('u1', f)).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: usa bucket avatars e retorna publicUrl', async () => {
    const { client, spies } = makeFakeClient({
      storage: {
        avatars: { publicUrl: 'https://cdn/avatar.jpg' },
      },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('me.jpg', 'image/jpeg', 200);
    const url = await uploadAvatar('u1', f);
    expect(url).toBe('https://cdn/avatar.jpg');
    expect(spies.storageFrom).toHaveBeenCalledWith('avatars');
    // path tem que começar com userId/ (storage policy)
    const uploadCall = spies.upload.mock.calls[0];
    expect(uploadCall?.[0]).toBe('avatars');
    expect(String(uploadCall?.[1])).toMatch(/^u1\//);
  });

  it('avatars falha → fallback pra bucket posts e retorna publicUrl do fallback', async () => {
    const { client, spies } = makeFakeClient({
      storage: {
        avatars: { uploadError: { message: 'policy denied' } },
        posts: { publicUrl: 'https://cdn/posts/avatar.jpg' },
      },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('me.jpg', 'image/jpeg', 200);
    const url = await uploadAvatar('u1', f);
    expect(url).toBe('https://cdn/posts/avatar.jpg');
    expect(spies.storageFrom).toHaveBeenCalledWith('avatars');
    expect(spies.storageFrom).toHaveBeenCalledWith('posts');
    // Path do fallback tem o prefixo "avatar_fallback_" pra ser identificável.
    const postsUploadCall = spies.upload.mock.calls[1];
    expect(String(postsUploadCall?.[1])).toMatch(/^u1\/avatar_fallback_/);
  });

  it('ambos buckets falham → joga NetworkError com message do último', async () => {
    const { client } = makeFakeClient({
      storage: {
        avatars: { uploadError: { message: 'avatars down' } },
        posts: { uploadError: { message: 'posts denied' } },
      },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('me.jpg', 'image/jpeg', 200);
    await expect(uploadAvatar('u1', f)).rejects.toBeInstanceOf(NetworkError);
    await expect(uploadAvatar('u1', f)).rejects.toMatchObject({
      message: 'posts denied',
    });
  });
});

// ─── getCidadesByUF ────────────────────────────────────────────────────────

describe('getCidadesByUF', () => {
  // Spy global em fetch — restaurado após cada teste pra não contaminar
  // outros services que dependem de fetch real. Tipamos como `unknown` e
  // reatribuímos com cast pra evitar conflito de overload do fetch nativo
  // com o MockInstance estrito do vitest.
  let fetchSpy: { mockRestore: () => void } | undefined;

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    fetchSpy = undefined;
  });

  it('UF vazia → []', async () => {
    const out = await getCidadesByUF('');
    expect(out).toEqual([]);
  });

  it('UF inválida (3 letras) → []', async () => {
    const out = await getCidadesByUF('XXX');
    expect(out).toEqual([]);
  });

  it('happy path: parse retorno do endpoint /api/cidades', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ uf: 'SP', cidades: [{ nome: 'São Paulo' }, { nome: 'Campinas' }] }),
        { status: 200 },
      ),
    );
    fetchSpy = spy as unknown as { mockRestore: () => void };
    const out = await getCidadesByUF('sp'); // testa normalização pra uppercase
    expect(out).toEqual(['São Paulo', 'Campinas']);
    expect(spy).toHaveBeenCalledWith('/api/cidades?uf=SP');
  });

  it('fetch falha (rede/4xx) → [] silencioso (best-effort)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404 }),
    );
    fetchSpy = spy as unknown as { mockRestore: () => void };
    const out = await getCidadesByUF('SP');
    expect(out).toEqual([]);
  });

  it('fetch joga → [] silencioso (best-effort)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    fetchSpy = spy as unknown as { mockRestore: () => void };
    const out = await getCidadesByUF('SP');
    expect(out).toEqual([]);
  });
});

// ─── getEspecialidadesByRole ───────────────────────────────────────────────

describe('getEspecialidadesByRole', () => {
  it('pintor → 10 especialidades', () => {
    const out = getEspecialidadesByRole('pintor');
    expect(out).toHaveLength(10);
    expect(out).toContain('Residencial');
    expect(out).toContain('Caiação');
  });

  it('grafiteiro → 10 especialidades', () => {
    const out = getEspecialidadesByRole('grafiteiro');
    expect(out).toHaveLength(10);
    expect(out).toContain('Grafite Artístico');
  });

  it('graffiti (sinônimo) → mesma lista de grafiteiro', () => {
    expect(getEspecialidadesByRole('graffiti')).toEqual(
      getEspecialidadesByRole('grafiteiro'),
    );
  });

  it('automotivo + funileiro (sinônimo) retornam a mesma lista', () => {
    const auto = getEspecialidadesByRole('automotivo');
    expect(auto).toHaveLength(10);
    expect(getEspecialidadesByRole('funileiro')).toEqual(auto);
  });

  it('cliente / admin / null / undefined → []', () => {
    expect(getEspecialidadesByRole('cliente')).toEqual([]);
    expect(getEspecialidadesByRole('admin')).toEqual([]);
    expect(getEspecialidadesByRole(null)).toEqual([]);
    expect(getEspecialidadesByRole(undefined)).toEqual([]);
    expect(getEspecialidadesByRole('desconhecido')).toEqual([]);
  });

  it('retorna cópia (não vaza a tabela ROLE_SPECS interna)', () => {
    const out = getEspecialidadesByRole('pintor');
    out.push('Hackeado');
    // ROLE_SPECS deve continuar com 10 itens — o push acima muta apenas a cópia.
    expect(ROLE_SPECS.pintor).toHaveLength(10);
  });
});
