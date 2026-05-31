// Tests do service lib/services/notes.ts.
// Pattern alinhado com postInteractions.test.ts: fake supabase chainable
// injetado via __setSupabaseForTests; spies em from/select/eq/update/etc.
//
// Cobertura (12 testes):
//   - listNotes: userId vazio → [] sem rede, happy filtra user_id + is(deleted_at,null) + order desc
//   - saveNote: body vazio → ValidationError, userId vazio → ValidationError, happy retorna row
//   - softDeleteNote: validações + happy retorna undoToken + erro vira NetworkError
//   - undoDeleteNote: happy + validações

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  listNotes,
  saveNote,
  softDeleteNote,
  undoDeleteNote,
} from '../../lib/services/notes';
import { NetworkError, ValidationError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────
// Reproduz o fake de postInteractions: queue de respostas + default,
// maybeSingle/single resolvem imediatamente, single() do insert também.

interface QueuedResp {
  data?: unknown;
  error?: unknown;
}

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

interface FakeOpts {
  data?: unknown;
  error?: unknown;
  responses?: QueuedResp[];
}

function makeFakeClient(opts: FakeOpts = {}): {
  client: unknown;
  spies: ChainSpies;
} {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    single: vi.fn(),
  };

  const queue = [...(opts.responses ?? [])];
  const defaultResp: QueuedResp = {
    data: opts.data ?? null,
    error: opts.error ?? null,
  };

  function nextResp(): QueuedResp {
    return queue.shift() ?? defaultResp;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
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
    is: (col: string, val: unknown) => {
      spies.is(col, val);
      return chain;
    },
    order: (col: string, optsOrder?: { ascending: boolean }) => {
      spies.order(col, optsOrder);
      return chain;
    },
    insert: (patch: Record<string, unknown>) => {
      spies.insert(patch);
      return chain;
    },
    update: (patch: Record<string, unknown>) => {
      spies.update(patch);
      return chain;
    },
    single: () => {
      spies.single();
      const r = nextResp();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResp();
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

// ─── listNotes ─────────────────────────────────────────────────────────────

describe('listNotes', () => {
  it('userId vazio → [] sem rede', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listNotes('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy: filtra user_id + is(deleted_at,null) + ordem desc', async () => {
    const rows = [
      { id: 'n1', user_id: 'u1', body: 'lembrar de comprar tinta', created_at: '2026-05-31T10:00:00Z' },
      { id: 'n2', user_id: 'u1', body: 'cliente Maria 14h', created_at: '2026-05-30T10:00:00Z' },
    ];
    const { client, spies } = makeFakeClient({ data: rows });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listNotes('u1');
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('notes');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    // Filtragem soft-delete: defesa em profundidade.
    expect(spies.is).toHaveBeenCalledWith('deleted_at', null);
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('erro do supabase → NetworkError', async () => {
    const { client } = makeFakeClient({ error: { message: 'rls' } });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(listNotes('u1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── saveNote ──────────────────────────────────────────────────────────────

describe('saveNote', () => {
  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveNote('', 'oi')).rejects.toBeInstanceOf(ValidationError);
  });

  it('body vazio (só espaço) → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveNote('u1', '   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: insert trimado + select.single retorna row hidratada', async () => {
    const row = {
      id: 'n1',
      user_id: 'u1',
      body: 'comprar pincel',
      created_at: '2026-05-31T10:00:00Z',
    };
    const { client, spies } = makeFakeClient({
      responses: [{ data: row, error: null }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await saveNote('u1', '  comprar pincel  ');
    expect(out).toEqual(row);
    expect(spies.from).toHaveBeenCalledWith('notes');
    expect(spies.insert).toHaveBeenCalledWith({ user_id: 'u1', body: 'comprar pincel' });
  });

  it('erro do supabase → NetworkError', async () => {
    const { client } = makeFakeClient({
      responses: [{ data: null, error: { message: 'fk' } }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveNote('u1', 'oi')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── softDeleteNote ────────────────────────────────────────────────────────

describe('softDeleteNote', () => {
  it('noteId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(softDeleteNote('', 'u1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(softDeleteNote('n1', '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: UPDATE SET deleted_at = ISO, eq id E user_id, retorna undoToken', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await softDeleteNote('n1', 'u1');
    expect(spies.from).toHaveBeenCalledWith('notes');
    const update = spies.update.mock.calls[0]?.[0] as { deleted_at: string };
    expect(update.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(spies.eq).toHaveBeenCalledWith('id', 'n1');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(out).toEqual({ undoToken: 'n1' });
  });

  it('erro do supabase → NetworkError', async () => {
    const { client } = makeFakeClient({ error: { message: 'rls' } });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(softDeleteNote('n1', 'u1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── undoDeleteNote ────────────────────────────────────────────────────────

describe('undoDeleteNote', () => {
  it('noteId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(undoDeleteNote('', 'u1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: UPDATE SET deleted_at = null com filtros id E user_id', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await undoDeleteNote('n1', 'u1');
    expect(spies.from).toHaveBeenCalledWith('notes');
    expect(spies.update).toHaveBeenCalledWith({ deleted_at: null });
    expect(spies.eq).toHaveBeenCalledWith('id', 'n1');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
  });
});
