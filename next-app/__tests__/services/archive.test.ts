// Tests do service lib/services/archive.ts.
// Pattern: fake supabase chainable injetado via __setSupabaseForTests. As
// queries do archive são:
//   - listArchived: .from().select().eq().single() → { archived_conversations }
//   - archive/unarchive: chama listArchived primeiro (read) + .from().update().eq()
//     (write) → cada um consome 2 items do queue.
//
// O `.single()` é terminator (Promise direta) — o `.then()` cobre os updates.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import { archive, listArchived, unarchive } from '../../lib/services/archive';
import { NetworkError, ValidationError } from '../../lib/errors';

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

interface QueueItem {
  data?: unknown;
  error?: unknown;
}

function makeFakeClient(queue: QueueItem[] = []): {
  client: unknown;
  spies: ChainSpies;
} {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    single: vi.fn(),
  };

  const responses = [...queue];
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
    // `.single()` é terminator — retorna Promise direto, consumindo um item
    // da queue.
    single: () => {
      spies.single();
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    // `.then` cobre os updates (que não terminam em .single()).
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResponse();
      resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  return { client: chain, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── listArchived ──────────────────────────────────────────────────────────

describe('listArchived', () => {
  it('userId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([
      { data: { archived_conversations: ['c1'] } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listArchived('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna array + usa filtros corretos', async () => {
    const { client, spies } = makeFakeClient([
      { data: { archived_conversations: ['conv-1', 'conv-2'] } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listArchived('u1');
    expect(out).toEqual(['conv-1', 'conv-2']);
    expect(spies.from).toHaveBeenCalledWith('profiles');
    expect(spies.select).toHaveBeenCalledWith('archived_conversations');
    expect(spies.eq).toHaveBeenCalledWith('id', 'u1');
    expect(spies.single).toHaveBeenCalled();
  });

  it('archived_conversations null (perfil novo) → [] sem estourar', async () => {
    const { client } = makeFakeClient([
      { data: { archived_conversations: null } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listArchived('u1');
    expect(out).toEqual([]);
  });

  it('filtra valores não-string (dado corrompido) → só strings', async () => {
    const { client } = makeFakeClient([
      { data: { archived_conversations: ['c1', 123, null, 'c2'] } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listArchived('u1');
    expect(out).toEqual(['c1', 'c2']);
  });

  it('error → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(listArchived('u1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── archive ───────────────────────────────────────────────────────────────

describe('archive', () => {
  it('userId vazio → ValidationError sem bater na rede', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(archive('', 'c1')).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('conversationId vazio → ValidationError sem bater na rede', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(archive('u1', '')).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: adiciona conv ao array e grava no perfil', async () => {
    // Queue: 1) listArchived single → existing array; 2) update → ok.
    const { client, spies } = makeFakeClient([
      { data: { archived_conversations: ['c1'] } },
      { data: null }, // update
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await archive('u1', 'c2');
    expect(out).toEqual(['c1', 'c2']);
    expect(spies.update).toHaveBeenCalledWith({
      archived_conversations: ['c1', 'c2'],
    });
  });

  it('idempotente: já arquivada → não dispara update', async () => {
    const { client, spies } = makeFakeClient([
      { data: { archived_conversations: ['c1', 'c2'] } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await archive('u1', 'c1');
    expect(out).toEqual(['c1', 'c2']);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('error no update → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: { archived_conversations: [] } },
      { data: null, error: { message: 'rls update' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(archive('u1', 'c1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── unarchive ─────────────────────────────────────────────────────────────

describe('unarchive', () => {
  it('userId vazio → ValidationError sem bater na rede', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(unarchive('', 'c1')).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: remove do array e grava no perfil', async () => {
    const { client, spies } = makeFakeClient([
      { data: { archived_conversations: ['c1', 'c2', 'c3'] } },
      { data: null },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await unarchive('u1', 'c2');
    expect(out).toEqual(['c1', 'c3']);
    expect(spies.update).toHaveBeenCalledWith({
      archived_conversations: ['c1', 'c3'],
    });
  });

  it('idempotente: conv não estava arquivada → não dispara update', async () => {
    const { client, spies } = makeFakeClient([
      { data: { archived_conversations: ['c1'] } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await unarchive('u1', 'c2');
    expect(out).toEqual(['c1']);
    expect(spies.update).not.toHaveBeenCalled();
  });
});
