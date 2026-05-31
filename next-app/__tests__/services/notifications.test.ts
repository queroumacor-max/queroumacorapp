// Tests do service lib/services/notifications.ts.
// Pattern: __setSupabaseForTests injeta um fake chainable consistente com a
// API do supabase-js (.from().select().eq().order().limit() → await yields
// { data, error }) — mesmo pattern usado em db.test.ts.
//
// Cobertura:
//   - fetchNotifications: happy path, erro → NetworkError, userId vazio → [];
//   - markAsRead: happy path (chama update + eq), erro → NetworkError, id
//     vazio → no-op silencioso (não bate na rede);
//   - markAllAsRead: happy path (update + eq user + eq read=false), erro,
//     userId vazio → no-op.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchNotifications,
  markAsRead,
  markAllAsRead,
} from '../../lib/services/notifications';
import { NetworkError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────
// Cada método retorna `chain` pra permitir `.from().select().eq().eq()` em
// qualquer ordem. O `then` faz o chain virar await-able no final, devolvendo
// { data, error }. Espiões em `from`, `select`, `eq`, `update` permitem
// asserções de "que tabela foi tocada", "que coluna foi atualizada", etc.

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

interface FakeOpts {
  data?: unknown;
  error?: unknown;
}

function makeFakeClient(opts: FakeOpts = {}): { client: unknown; spies: ChainSpies } {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
  };

  const chain = {
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
    order: (col: string, optsOrder: { ascending: boolean }) => {
      spies.order(col, optsOrder);
      return chain;
    },
    limit: (n: number) => {
      spies.limit(n);
      return chain;
    },
    update: (patch: Record<string, unknown>) => {
      spies.update(patch);
      return chain;
    },
    // PostgrestBuilder vira await-able no final via `then`.
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: opts.data ?? null, error: opts.error ?? null }),
  };

  return {
    client: chain,
    spies,
  };
}

beforeEach(() => {
  __resetSupabaseForTests();
  // Setar env vars pra getSupabase() não estourar antes do override
  // (__setSupabaseForTests dentro de cada teste injeta o fake real).
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchNotifications ────────────────────────────────────────────────────

describe('fetchNotifications', () => {
  it('userId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient({ data: [{ id: 'n1' }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchNotifications('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna data e usa filtros corretos', async () => {
    const rows = [
      { id: 'n1', user_id: 'u1', type: 'like', title: 'curtiu', body: null, read: false, created_at: '2026-05-31T10:00:00Z' },
      { id: 'n2', user_id: 'u1', type: 'comment', title: 'comentou', body: 'oi', read: true, created_at: '2026-05-30T10:00:00Z' },
    ];
    const { client, spies } = makeFakeClient({ data: rows });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await fetchNotifications('u1');
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('notifications');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
    // DEFAULT_LIMIT = 50 (interno ao service).
    expect(spies.limit).toHaveBeenCalledWith(50);
  });

  it('data null → resolve [] (não [null])', async () => {
    const { client } = makeFakeClient({ data: null });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchNotifications('u1');
    expect(out).toEqual([]);
  });

  it('error path → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient({
      data: null,
      error: { message: 'rls bloqueou' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchNotifications('u1')).rejects.toBeInstanceOf(NetworkError);
    await expect(fetchNotifications('u1')).rejects.toMatchObject({
      message: 'rls bloqueou',
    });
  });
});

// ─── markAsRead ────────────────────────────────────────────────────────────

describe('markAsRead', () => {
  it('id vazio → no-op (não toca no client)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await markAsRead('');
    expect(spies.from).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('happy path: chama update({read:true}) e filtra por id', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await markAsRead('n1');
    expect(spies.from).toHaveBeenCalledWith('notifications');
    expect(spies.update).toHaveBeenCalledWith({ read: true });
    expect(spies.eq).toHaveBeenCalledWith('id', 'n1');
  });

  it('error path → joga NetworkError', async () => {
    const { client } = makeFakeClient({
      error: { message: 'permission denied' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(markAsRead('n1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── markAllAsRead ─────────────────────────────────────────────────────────

describe('markAllAsRead', () => {
  it('userId vazio → no-op', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await markAllAsRead('');
    expect(spies.from).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('happy path: update({read:true}) + filtro user_id + read=false', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await markAllAsRead('u1');
    expect(spies.from).toHaveBeenCalledWith('notifications');
    expect(spies.update).toHaveBeenCalledWith({ read: true });
    // Tem que filtrar por user_id E por read=false (economiza UPDATE em
    // linhas já lidas — comportamento documentado no service).
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(spies.eq).toHaveBeenCalledWith('read', false);
  });

  it('error path → joga NetworkError', async () => {
    const { client } = makeFakeClient({
      error: { message: 'fk violation' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(markAllAsRead('u1')).rejects.toBeInstanceOf(NetworkError);
  });
});
