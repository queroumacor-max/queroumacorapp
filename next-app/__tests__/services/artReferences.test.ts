// Testes de lib/services/artReferences.ts — foco na extensão CSAM de
// 2026-09-17 (image_hash): uploadArtReference calcula o SHA-256 do arquivo
// e grava em art_references.image_hash, tolerando a migration ainda não
// ter rodado (mesmo padrão de graceful-degradation de updateProfile em
// profile.ts — recurso novo não pode derrubar upload que já funcionava).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import { NetworkError, ValidationError } from '../../lib/errors';

// 2026-09-17 (achado do Codex, PR #325): uploadArtReference agora chama
// assertMediaApproved (checagem AUTORITATIVA, hash calculado no servidor)
// antes de inserir a linha — o trigger de blocklist sozinho confiava no
// hash que o CLIENTE manda, falsificável via PostgREST direto. Default
// aprova; os testes de bloqueio sobrescrevem.
const assertMediaApprovedMock = vi.fn(async (_args: { mediaUrl: string; text?: string | null }) => {});
vi.mock('@/lib/services/moderateMedia', () => ({
  assertMediaApproved: (args: { mediaUrl: string; text?: string | null }) =>
    assertMediaApprovedMock(args),
}));

import { uploadArtReference } from '../../lib/services/artReferences';

interface InsertQueueItem {
  data?: unknown;
  error?: { message: string } | null;
}

function makeFakeClient(opts: {
  insertQueue: InsertQueueItem[];
  uploadError?: { message: string } | null;
}): { client: unknown; insertSpy: ReturnType<typeof vi.fn>; removeSpy: ReturnType<typeof vi.fn> } {
  const insertSpy = vi.fn();
  const removeSpy = vi.fn();
  const queue = [...opts.insertQueue];

  const client = {
    from: (_t: string) => ({
      insert: (row: Record<string, unknown>) => {
        insertSpy(row);
        return {
          select: (_cols: string) => ({
            single: async () => {
              const next = queue.shift() ?? { data: null, error: null };
              return { data: next.data ?? null, error: next.error ?? null };
            },
          }),
        };
      },
    }),
    storage: {
      from: (_bucket: string) => ({
        upload: async () => ({
          data: opts.uploadError ? null : { path: 'u1/abc.jpg' },
          error: opts.uploadError ?? null,
        }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn/art-refs/${path}` },
        }),
        remove: (...args: unknown[]) => {
          removeSpy(...args);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  };

  return { client, insertSpy, removeSpy };
}

function makeFile(bytes = 100): File {
  return new File([new Uint8Array(bytes)], 'ref.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
  __resetSupabaseForTests();
  assertMediaApprovedMock.mockReset();
  assertMediaApprovedMock.mockResolvedValue(undefined);
});

describe('uploadArtReference — image_hash (extensão CSAM 2026-09-17)', () => {
  it('calcula o SHA-256 e grava em image_hash no insert', async () => {
    const row = {
      id: 'r1',
      user_id: 'u1',
      title: null,
      image_url: 'https://cdn/art-refs/u1/abc.jpg',
      tags: [],
      width: null,
      height: null,
      created_at: '2026-09-17T00:00:00Z',
    };
    const { client, insertSpy } = makeFakeClient({ insertQueue: [{ data: row }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    await uploadArtReference({ userId: 'u1', file: makeFile() });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const inserted = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof inserted.image_hash).toBe('string');
    expect(inserted.image_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('migration pendente (coluna image_hash ausente) → retenta sem ela, upload não quebra', async () => {
    const row = {
      id: 'r1',
      user_id: 'u1',
      title: null,
      image_url: 'https://cdn/art-refs/u1/abc.jpg',
      tags: [],
      width: null,
      height: null,
      created_at: '2026-09-17T00:00:00Z',
    };
    const { client, insertSpy } = makeFakeClient({
      insertQueue: [
        { data: null, error: { message: "Could not find the 'image_hash' column of 'art_references' in the schema cache" } },
        { data: row },
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const result = await uploadArtReference({ userId: 'u1', file: makeFile() });

    expect(result.id).toBe('r1');
    expect(insertSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy.mock.calls[0][0]).toHaveProperty('image_hash');
    expect(insertSpy.mock.calls[1][0]).not.toHaveProperty('image_hash');
  });

  it('erro de banco NÃO relacionado à coluna ausente ainda estoura NetworkError (com cleanup do storage)', async () => {
    const { client, insertSpy, removeSpy } = makeFakeClient({
      insertQueue: [{ data: null, error: { message: 'permission denied for table art_references' } }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    await expect(uploadArtReference({ userId: 'u1', file: makeFile() })).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('uploadArtReference — checagem autoritativa de moderação (achado Codex, PR #325)', () => {
  it('chama assertMediaApproved com a URL pública ANTES de inserir a linha', async () => {
    const row = {
      id: 'r1',
      user_id: 'u1',
      title: null,
      image_url: 'https://cdn/art-refs/u1/abc.jpg',
      tags: [],
      width: null,
      height: null,
      created_at: '2026-09-17T00:00:00Z',
    };
    const { client, insertSpy } = makeFakeClient({ insertQueue: [{ data: row }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    await uploadArtReference({ userId: 'u1', file: makeFile() });

    expect(assertMediaApprovedMock).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: expect.stringContaining('art-refs') }),
    );
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('reprovado (assertMediaApproved lança) → NÃO insere linha e limpa o storage', async () => {
    assertMediaApprovedMock.mockRejectedValue(
      new ValidationError('Este conteúdo não pode ser publicado por violar as diretrizes da comunidade.'),
    );
    const { client, insertSpy, removeSpy } = makeFakeClient({ insertQueue: [] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    await expect(uploadArtReference({ userId: 'u1', file: makeFile() })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(insertSpy).not.toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
