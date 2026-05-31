// Tests do service lib/services/featureFlags.ts (Grande#4).
// Pattern alinhado com __tests__/services/notifications.test.ts: fake supabase
// chainable + supabase.rpc mockado. Cobre 6 cenários:
//
//   - fetchFlags: happy path + erro → NetworkError;
//   - isFlagEnabled: happy true, happy false, key vazia → false (sem rede),
//     erro RPC → fail-closed (false);
//   - updateFlag: erro Supabase → NetworkError.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchFlags,
  isFlagEnabled,
  updateFlag,
} from '../../lib/services/featureFlags';
import { NetworkError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

interface FakeOpts {
  data?: unknown;
  error?: unknown;
  rpcData?: unknown;
  rpcError?: unknown;
}

function makeFakeClient(opts: FakeOpts = {}): { client: unknown; spies: ChainSpies } {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    update: vi.fn(),
    rpc: vi.fn(),
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
    update: (patch: Record<string, unknown>) => {
      spies.update(patch);
      return chain;
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      spies.rpc(fn, params);
      // RPC retorna { data, error } direto, sem chaining (Promise<...>)
      return Promise.resolve({
        data: opts.rpcData ?? null,
        error: opts.rpcError ?? null,
      });
    },
    // await na chain inteira (from/select/eq/update).
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: opts.data ?? null, error: opts.error ?? null }),
  };

  return { client: chain, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchFlags ────────────────────────────────────────────────────────────

describe('fetchFlags', () => {
  it('happy path: retorna lista ordenada por key', async () => {
    const rows = [
      { key: 'ai_voice_chat', enabled: true, description: 'Seu Zé voice', rollout_percent: 100 },
      { key: 'story_video', enabled: false, description: 'Vídeo em stories', rollout_percent: 50 },
    ];
    const { client, spies } = makeFakeClient({ data: rows });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await fetchFlags();
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('feature_flags');
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.order).toHaveBeenCalledWith('key', { ascending: true });
  });

  it('error path → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient({
      data: null,
      error: { message: 'fora do ar' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchFlags()).rejects.toBeInstanceOf(NetworkError);
    await expect(fetchFlags()).rejects.toMatchObject({
      message: 'fora do ar',
    });
  });
});

// ─── isFlagEnabled ─────────────────────────────────────────────────────────

describe('isFlagEnabled', () => {
  it('key vazia → false sem bater na rede', async () => {
    const { client, spies } = makeFakeClient({ rpcData: true });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await isFlagEnabled('');
    expect(out).toBe(false);
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('happy path true: chama RPC is_feature_enabled com p_key e p_user_id', async () => {
    const { client, spies } = makeFakeClient({ rpcData: true });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await isFlagEnabled('ai_voice_chat', 'u1');
    expect(out).toBe(true);
    expect(spies.rpc).toHaveBeenCalledWith('is_feature_enabled', {
      p_key: 'ai_voice_chat',
      p_user_id: 'u1',
    });
  });

  it('happy path false: RPC retornou false', async () => {
    const { client } = makeFakeClient({ rpcData: false });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await isFlagEnabled('full_text_search', 'u1');
    expect(out).toBe(false);
  });

  it('fail-closed: erro RPC retorna false (não throws)', async () => {
    const { client } = makeFakeClient({
      rpcData: null,
      rpcError: { message: 'rpc timeout' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await isFlagEnabled('story_video', 'u1');
    expect(out).toBe(false);
  });
});

// ─── updateFlag ────────────────────────────────────────────────────────────

describe('updateFlag', () => {
  it('error path → joga NetworkError', async () => {
    const { client } = makeFakeClient({
      error: { message: 'rls bloqueou' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(updateFlag('ai_voice_chat', { enabled: false })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
