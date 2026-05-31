// Tests do service lib/services/aiArt.ts.
// Pattern alinhado com pedidos/profile.test.ts: fake supabase chainable
// + spy global em fetch pra cobrir o endpoint /api/ig-art.
//
// Cobertura (mín 10 testes pedido pelo spec):
//   - generateArt: userId vazio → ValidationError; photo1 vazia → ValidationError;
//     antesdepois sem photo2 → ValidationError; photo1 não data URL →
//     ValidationError; happy path; HTTP 429; HTTP 500 com detail; resposta sem
//     imageDataUrl → NetworkError.
//   - applyLogoToImage: imageUrl/logoUrl vazios → ValidationError.
//   - getDailyCreditsUsed/incrementCredits/maxCredits: lifecycle no localStorage,
//     reseta por dia (chave inclui data).
//   - postArtToFeed: userId vazio → ValidationError; happy path; imageDataUrl
//     inválida → ValidationError; storage upload falha → NetworkError +
//     fallback de remoção.
//   - uploadTemplate: admin vazio → ValidationError; não-imagem → ValidationError.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  generateArt,
  applyLogoToImage,
  getDailyCreditsUsed,
  incrementCredits,
  maxCredits,
  postArtToFeed,
  uploadTemplate,
  DAILY_CREDITS_LIMIT,
} from '../../lib/services/aiArt';
import { NetworkError, ValidationError } from '../../lib/errors';

// ─── helpers ────────────────────────────────────────────────────────────────

// data URL minúscula válida (1x1 GIF transparente — passa no regex que
// generateArt usa pra validar input).
const TINY_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Fake supabase com storage upload + getPublicUrl + from.insert.
interface StorageResp {
  uploadError?: unknown;
  publicUrl?: string;
  removeError?: unknown;
}

interface FakeOpts {
  storage?: Record<string, StorageResp>;
  insertError?: unknown;
}

function makeFakeClient(opts: FakeOpts = {}) {
  const spies = {
    from: vi.fn(),
    insert: vi.fn(),
    storageFrom: vi.fn(),
    upload: vi.fn(),
    getPublicUrl: vi.fn(),
    remove: vi.fn(),
  };

  const tableChain = {
    insert: (row: Record<string, unknown>) => {
      spies.insert(row);
      return Promise.resolve({ data: null, error: opts.insertError ?? null });
    },
  };

  const storageBuckets = opts.storage ?? {};
  const storage = {
    from: (bucket: string) => {
      spies.storageFrom(bucket);
      const resp = storageBuckets[bucket] ?? {};
      return {
        upload: (path: string, file: unknown, options?: unknown) => {
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
        remove: (paths: string[]) => {
          spies.remove(bucket, paths);
          return Promise.resolve({ data: null, error: resp.removeError ?? null });
        },
      };
    },
  };

  const client = {
    from: (t: string) => {
      spies.from(t);
      return tableChain;
    },
    storage,
  };

  return { client, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
  // localStorage polyfill — vitest com environment: 'node' não tem
  // localStorage. Injeta um fake antes de cada teste pra getDailyCreditsUsed
  // funcionar sem reclamar.
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  } else {
    localStorage.clear();
  }
});

// ─── generateArt ────────────────────────────────────────────────────────────

describe('generateArt', () => {
  let fetchSpy: { mockRestore: () => void } | undefined;
  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    fetchSpy = undefined;
  });

  it('userId vazio → ValidationError sem bater na rede', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    fetchSpy = spy as unknown as { mockRestore: () => void };
    await expect(
      generateArt({
        userId: '',
        style: 'profissional',
        aspect: 'square',
        photo1: TINY_DATA_URL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('photo1 vazia → ValidationError', async () => {
    await expect(
      generateArt({
        userId: 'u1',
        style: 'profissional',
        aspect: 'square',
        photo1: '',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('photo1 não é data URL → ValidationError', async () => {
    await expect(
      generateArt({
        userId: 'u1',
        style: 'profissional',
        aspect: 'square',
        photo1: 'https://example.com/foo.jpg',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('antesdepois sem photo2 → ValidationError com field=photo2', async () => {
    await expect(
      generateArt({
        userId: 'u1',
        style: 'antesdepois',
        aspect: 'square',
        photo1: TINY_DATA_URL,
      }),
    ).rejects.toMatchObject({
      name: 'ValidationError',
      details: { field: 'photo2' },
    });
  });

  it('happy path: bate em /api/ig-art e retorna imageDataUrl + caption', async () => {
    const fakeImg = 'data:image/png;base64,XYZ';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          imageDataUrl: fakeImg,
          caption: 'Trabalho entregue!',
          style: 'profissional',
          aspect: 'square',
          model: 'gpt-image-1+ref',
        }),
        { status: 200 },
      ),
    );
    fetchSpy = spy as unknown as { mockRestore: () => void };

    const out = await generateArt({
      userId: 'u1',
      style: 'profissional',
      aspect: 'square',
      photo1: TINY_DATA_URL,
      hint: 'transmita confiança',
      bizName: 'Pintor JK',
    });

    expect(out.imageDataUrl).toBe(fakeImg);
    expect(out.caption).toBe('Trabalho entregue!');
    expect(out.style).toBe('profissional');
    expect(out.aspect).toBe('square');
    expect(out.model).toBe('gpt-image-1+ref');

    // Verifica que o body do POST carrega os campos certos.
    const call = spy.mock.calls[0];
    expect(call[0]).toBe('/api/ig-art');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.style).toBe('profissional');
    expect(body.aspect).toBe('square');
    expect(body.photoDataUrl).toBe(TINY_DATA_URL);
    expect(body.captionHint).toBe('transmita confiança');
    expect(body.businessName).toBe('Pintor JK');

    // Crédito incrementado em sucesso (1 ainda dentro do limite).
    expect(getDailyCreditsUsed('u1')).toBe(1);
  });

  it('style=criativo é mapeado pra backend "portrait"', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ imageDataUrl: 'data:image/png;base64,A' }),
        { status: 200 },
      ),
    );
    fetchSpy = spy as unknown as { mockRestore: () => void };

    await generateArt({
      userId: 'u1',
      style: 'criativo',
      aspect: 'vertical',
      photo1: TINY_DATA_URL,
    });

    const init = spy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.style).toBe('portrait');
  });

  it('HTTP 429 → NetworkError com mensagem do backend', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Limite diário atingido' }),
        { status: 429 },
      ),
    );
    fetchSpy = spy as unknown as { mockRestore: () => void };

    await expect(
      generateArt({
        userId: 'u1',
        style: 'profissional',
        aspect: 'square',
        photo1: TINY_DATA_URL,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('HTTP 502 com detail + model_tried → mensagem combinada', async () => {
    // mockImplementation pra gerar Response novo a cada call (Response.body
    // só pode ser lido uma vez — reuso quebraria a segunda assertion).
    const makeResp = () =>
      new Response(
        JSON.stringify({
          error: 'Falha ao gerar arte',
          detail: 'OpenAI 500: server error',
          model_tried: 'gpt-image-1+ref',
        }),
        { status: 502 },
      );
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(makeResp()));
    fetchSpy = spy as unknown as { mockRestore: () => void };

    await expect(
      generateArt({
        userId: 'u1',
        style: 'profissional',
        aspect: 'square',
        photo1: TINY_DATA_URL,
      }),
    ).rejects.toMatchObject({
      name: 'NetworkError',
      message: expect.stringContaining('Falha ao gerar arte'),
    });
    await expect(
      generateArt({
        userId: 'u1',
        style: 'profissional',
        aspect: 'square',
        photo1: TINY_DATA_URL,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('gpt-image-1+ref'),
    });
  });

  it('200 sem imageDataUrl → NetworkError "Provider não devolveu imagem"', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ caption: 'só legenda' }), { status: 200 }),
    );
    fetchSpy = spy as unknown as { mockRestore: () => void };

    await expect(
      generateArt({
        userId: 'u1',
        style: 'profissional',
        aspect: 'square',
        photo1: TINY_DATA_URL,
      }),
    ).rejects.toMatchObject({
      name: 'NetworkError',
      message: expect.stringContaining('Provider não devolveu imagem'),
    });
  });

  it('antesdepois com photo2 inclui photoDataUrl2 no body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ imageDataUrl: 'data:image/png;base64,A' }),
        { status: 200 },
      ),
    );
    fetchSpy = spy as unknown as { mockRestore: () => void };

    await generateArt({
      userId: 'u1',
      style: 'antesdepois',
      aspect: 'square',
      photo1: TINY_DATA_URL,
      photo2: TINY_DATA_URL,
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.photoDataUrl2).toBe(TINY_DATA_URL);
  });

  it('fetch joga → NetworkError', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connection refused'));
    fetchSpy = spy as unknown as { mockRestore: () => void };

    await expect(
      generateArt({
        userId: 'u1',
        style: 'profissional',
        aspect: 'square',
        photo1: TINY_DATA_URL,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── applyLogoToImage ──────────────────────────────────────────────────────

describe('applyLogoToImage', () => {
  it('imageUrl vazia → ValidationError', async () => {
    await expect(
      applyLogoToImage('', 'https://x/y.png'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('logoUrl vazia → ValidationError', async () => {
    await expect(
      applyLogoToImage('https://x/y.png', ''),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rodando em node (sem document) → NetworkError', async () => {
    // O env de teste é 'node' (vitest config), então document é undefined.
    await expect(
      applyLogoToImage('https://x/img.png', 'https://x/logo.png'),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── créditos diários ──────────────────────────────────────────────────────

describe('credits (daily)', () => {
  it('getDailyCreditsUsed começa em 0 sem nada gravado', () => {
    expect(getDailyCreditsUsed('user-fresh')).toBe(0);
  });

  it('incrementCredits soma 1 por chamada', () => {
    incrementCredits('uX');
    incrementCredits('uX');
    incrementCredits('uX');
    expect(getDailyCreditsUsed('uX')).toBe(3);
  });

  it('maxCredits força no DAILY_CREDITS_LIMIT', () => {
    incrementCredits('uY');
    expect(getDailyCreditsUsed('uY')).toBe(1);
    maxCredits('uY');
    expect(getDailyCreditsUsed('uY')).toBe(DAILY_CREDITS_LIMIT);
  });

  it('contador é isolado por userId', () => {
    incrementCredits('alice');
    incrementCredits('alice');
    incrementCredits('bob');
    expect(getDailyCreditsUsed('alice')).toBe(2);
    expect(getDailyCreditsUsed('bob')).toBe(1);
    expect(getDailyCreditsUsed('carol')).toBe(0);
  });

  it('chave inclui data — usuário sem nada hoje vê 0 mesmo com gravação ontem', () => {
    // Simula gravação manual numa key de data anterior — getDailyCreditsUsed
    // lê só a key do dia corrente, então ignora a antiga.
    localStorage.setItem('igArt:credits:u1:2020-01-01', '5');
    expect(getDailyCreditsUsed('u1')).toBe(0);
  });
});

// ─── postArtToFeed ──────────────────────────────────────────────────────────

describe('postArtToFeed', () => {
  it('userId vazio → ValidationError', async () => {
    await expect(
      postArtToFeed({
        userId: '',
        imageDataUrl: TINY_DATA_URL,
        caption: 'x',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('imageDataUrl vazia → ValidationError', async () => {
    await expect(
      postArtToFeed({ userId: 'u1', imageDataUrl: '', caption: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('imageDataUrl inválida → ValidationError', async () => {
    await expect(
      postArtToFeed({
        userId: 'u1',
        imageDataUrl: 'not-a-data-url',
        caption: 'x',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: faz upload + insert + retorna mediaUrl', async () => {
    const { client, spies } = makeFakeClient({
      storage: {
        posts: { publicUrl: 'https://cdn/posts/ai-art-abc.png' },
      },
    });
    __setSupabaseForTests(
      client as unknown as Parameters<typeof __setSupabaseForTests>[0],
    );

    const out = await postArtToFeed({
      userId: 'u1',
      imageDataUrl: TINY_DATA_URL,
      caption: 'Minha arte!',
    });
    expect(out.ok).toBe(true);
    expect(out.mediaUrl).toBe('https://cdn/posts/ai-art-abc.png');
    expect(out.status).toBe('approved');

    // Bucket é `posts`, path tem prefixo userId/ + ai-art-.
    expect(spies.storageFrom).toHaveBeenCalledWith('posts');
    const up = spies.upload.mock.calls[0];
    expect(String(up?.[1])).toMatch(/^u1\/ai-art-/);

    // Insert recebeu media_url e caption.
    const insertRow = spies.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertRow.media_url).toBe('https://cdn/posts/ai-art-abc.png');
    expect(insertRow.caption).toBe('Minha arte!');
    expect(insertRow.user_id).toBe('u1');
    expect(insertRow.media_type).toBe('image');
    expect(insertRow.status).toBe('approved');
  });

  it('storage upload falha → NetworkError', async () => {
    const { client } = makeFakeClient({
      storage: {
        posts: { uploadError: { message: 'storage policy denied' } },
      },
    });
    __setSupabaseForTests(
      client as unknown as Parameters<typeof __setSupabaseForTests>[0],
    );
    await expect(
      postArtToFeed({
        userId: 'u1',
        imageDataUrl: TINY_DATA_URL,
        caption: 'x',
      }),
    ).rejects.toMatchObject({
      name: 'NetworkError',
      message: 'storage policy denied',
    });
  });

  it('insert falha após upload → tenta remover blob órfão + NetworkError', async () => {
    const { client, spies } = makeFakeClient({
      storage: {
        posts: { publicUrl: 'https://cdn/posts/abc.png' },
      },
      insertError: { message: 'rls insert blocked' },
    });
    __setSupabaseForTests(
      client as unknown as Parameters<typeof __setSupabaseForTests>[0],
    );

    await expect(
      postArtToFeed({
        userId: 'u1',
        imageDataUrl: TINY_DATA_URL,
        caption: 'x',
      }),
    ).rejects.toMatchObject({
      name: 'NetworkError',
      message: 'rls insert blocked',
    });

    // Verifica que o cleanup foi chamado.
    expect(spies.remove).toHaveBeenCalled();
  });

  it('upload sem publicUrl retornado → NetworkError "Sem publicUrl"', async () => {
    const { client } = makeFakeClient({
      storage: {
        posts: { publicUrl: '' }, // sem publicUrl
      },
    });
    __setSupabaseForTests(
      client as unknown as Parameters<typeof __setSupabaseForTests>[0],
    );
    await expect(
      postArtToFeed({
        userId: 'u1',
        imageDataUrl: TINY_DATA_URL,
        caption: 'x',
      }),
    ).rejects.toMatchObject({
      name: 'NetworkError',
      message: expect.stringContaining('publicUrl'),
    });
  });
});

// ─── uploadTemplate (admin) ─────────────────────────────────────────────────

describe('uploadTemplate', () => {
  function makeFile(name: string, type: string, size: number): File {
    const blob = new Blob([new Uint8Array(size)], { type });
    return new File([blob], name, { type });
  }

  it('adminUserId vazio → ValidationError', async () => {
    const f = makeFile('a.jpg', 'image/jpeg', 100);
    await expect(uploadTemplate('', 'profissional', f)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('file não-imagem → ValidationError', async () => {
    const f = makeFile('doc.pdf', 'application/pdf', 100);
    await expect(
      uploadTemplate('admin1', 'profissional', f),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('file > 4MB → ValidationError', async () => {
    const f = makeFile('big.jpg', 'image/jpeg', 5 * 1024 * 1024);
    await expect(
      uploadTemplate('admin1', 'profissional', f),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
