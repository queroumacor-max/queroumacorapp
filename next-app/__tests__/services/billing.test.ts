// Tests do service lib/services/billing.ts.
// Pattern: mesma estratégia do notifications.test.ts — injeta fake client
// via __setSupabaseForTests, chainable que devolve { data, error } no `then`.
// Adiciona spy de `.rpc()` pra cobrir is_pro_active, upsert_invoice e
// ai_usage_this_month.
//
// Cobertura (14 cenários — passa do mín 10):
//   fetchInvoices:
//     1. userId vazio → resolve [] sem bater na rede
//     2. happy path: dados e filtro user_id
//     3. error → NetworkError
//   recordInvoice:
//     4. external_id ausente → ValidationError
//     5. type ausente → ValidationError
//     6. amount inválido (NaN) → ValidationError
//     7. happy path: chama rpc('upsert_invoice', payload)
//     8. error → NetworkError
//   getAiUsageThisMonth:
//     9. userId vazio → 0
//    10. happy path: chama rpc('ai_usage_this_month'), retorna número
//    11. erro → 0 (fail-open silencioso)
//   recordAiUsage:
//    12. userId vazio → no-op (não toca no client)
//    13. happy path: chama insert em ai_usage com feature
//   getPlanLimit:
//    14. happy path: lê do banco
//    15. erro → fallback hardcoded
//   canUseAi:
//    16. userId vazio → allowed=false
//    17. PRO ativo, used<limit → allowed=true, plan=pro
//    18. free user que excedeu (used>limit) → allowed=false
//    19. admin → plan=admin, allowed=true

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchInvoices,
  recordInvoice,
  getAiUsageThisMonth,
  recordAiUsage,
  getPlanLimit,
  canUseAi,
} from '../../lib/services/billing';
import { NetworkError, ValidationError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

interface FakeOpts {
  data?: unknown;
  error?: unknown;
  rpcResponses?: Record<string, { data?: unknown; error?: unknown }>;
}

function makeFakeClient(opts: FakeOpts = {}): { client: unknown; spies: ChainSpies } {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn(),
    rpc: vi.fn(),
  };

  // O chain principal pra .from(...).select(...).eq().order().limit() etc.
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
    order: (col: string, opts2: { ascending: boolean }) => {
      spies.order(col, opts2);
      return chain;
    },
    limit: (n: number) => {
      spies.limit(n);
      return chain;
    },
    insert: (row: Record<string, unknown>) => {
      spies.insert(row);
      return chain;
    },
    maybeSingle: () => {
      spies.maybeSingle();
      return Promise.resolve({
        data: opts.data ?? null,
        error: opts.error ?? null,
      });
    },
    // PostgrestBuilder await-able no final via `then`.
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: opts.data ?? null, error: opts.error ?? null }),
  };

  // .rpc() pode ter respostas custom por nome de RPC.
  const fullClient = {
    ...chain,
    from: chain.from,
    rpc: (name: string, params?: unknown) => {
      spies.rpc(name, params);
      const r = opts.rpcResponses?.[name];
      if (r) {
        return Promise.resolve({
          data: r.data ?? null,
          error: r.error ?? null,
        });
      }
      // Default: ecoa a `data`/`error` global. Útil pra "happy path" simples.
      return Promise.resolve({ data: opts.data ?? null, error: opts.error ?? null });
    },
  };

  return { client: fullClient, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchInvoices ─────────────────────────────────────────────────────────

describe('fetchInvoices', () => {
  it('userId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient({ data: [{ id: 'i1' }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchInvoices('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna data e filtra por user_id + ordena por created_at desc', async () => {
    const rows = [
      {
        id: 'i1',
        user_id: 'u1',
        external_id: 'mp_1',
        provider: 'mercadopago',
        type: 'subscription',
        amount: 39,
        currency: 'BRL',
        status: 'paid',
      },
    ];
    const { client, spies } = makeFakeClient({ data: rows });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await fetchInvoices('u1');
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('invoices');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('error path → NetworkError', async () => {
    const { client } = makeFakeClient({ error: { message: 'rls' } });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchInvoices('u1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── recordInvoice ─────────────────────────────────────────────────────────

describe('recordInvoice', () => {
  it('external_id ausente → ValidationError', async () => {
    await expect(
      recordInvoice({
        external_id: '',
        type: 'subscription',
        amount: 39,
        status: 'paid',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('type ausente → ValidationError', async () => {
    await expect(
      // @ts-expect-error testing invalid input
      recordInvoice({ external_id: 'mp_1', amount: 39, status: 'paid' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('amount NaN → ValidationError', async () => {
    await expect(
      recordInvoice({
        external_id: 'mp_1',
        type: 'subscription',
        amount: Number.NaN,
        status: 'paid',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: chama rpc("upsert_invoice") com payload completo', async () => {
    const row = { id: 'i1', external_id: 'mp_1', status: 'paid' };
    const { client, spies } = makeFakeClient({
      rpcResponses: { upsert_invoice: { data: row } },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await recordInvoice({
      user_id: 'u1',
      external_id: 'mp_1',
      type: 'subscription',
      amount: 39,
      status: 'paid',
    });
    expect(out).toEqual(row);
    expect(spies.rpc).toHaveBeenCalledWith(
      'upsert_invoice',
      expect.objectContaining({
        p_external_id: 'mp_1',
        p_type: 'subscription',
        p_amount: 39,
        p_status: 'paid',
        p_provider: 'mercadopago',
        p_currency: 'BRL',
      })
    );
  });

  it('rpc retorna error → NetworkError', async () => {
    const { client } = makeFakeClient({
      rpcResponses: { upsert_invoice: { error: { message: 'fk violation' } } },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      recordInvoice({
        external_id: 'mp_1',
        type: 'subscription',
        amount: 39,
        status: 'paid',
      })
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── getAiUsageThisMonth ──────────────────────────────────────────────────

describe('getAiUsageThisMonth', () => {
  it('userId vazio → 0', async () => {
    const { client, spies } = makeFakeClient({
      rpcResponses: { ai_usage_this_month: { data: 42 } },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getAiUsageThisMonth('');
    expect(out).toBe(0);
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('happy path: chama rpc com user_id e retorna número', async () => {
    const { client, spies } = makeFakeClient({
      rpcResponses: { ai_usage_this_month: { data: 15 } },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getAiUsageThisMonth('u1', 'chat_ai');
    expect(out).toBe(15);
    expect(spies.rpc).toHaveBeenCalledWith('ai_usage_this_month', {
      p_user_id: 'u1',
      p_feature: 'chat_ai',
    });
  });

  it('rpc retorna error → 0 (fail-open)', async () => {
    const { client } = makeFakeClient({
      rpcResponses: { ai_usage_this_month: { error: { message: 'rls' } } },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getAiUsageThisMonth('u1');
    expect(out).toBe(0);
  });
});

// ─── recordAiUsage ─────────────────────────────────────────────────────────

describe('recordAiUsage', () => {
  it('userId vazio → no-op', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await recordAiUsage('', 'chat_ai');
    expect(spies.from).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('happy path: insert em ai_usage', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await recordAiUsage('u1', 'chat_ai');
    expect(spies.from).toHaveBeenCalledWith('ai_usage');
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        feature: 'chat_ai',
        cost_units: 1,
      })
    );
  });

  it('error em insert → silencioso (não estoura)', async () => {
    const { client } = makeFakeClient({ error: { message: 'fk' } });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    // Não estoura, mesmo com error.
    await expect(recordAiUsage('u1', 'chat_ai')).resolves.toBeUndefined();
  });
});

// ─── getPlanLimit ──────────────────────────────────────────────────────────

describe('getPlanLimit', () => {
  it('happy path: lê do banco', async () => {
    const row = { plan: 'pro', ai_monthly_limit: 500, features: {} };
    const { client, spies } = makeFakeClient({ data: row });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getPlanLimit('pro');
    expect(out).toEqual(row);
    expect(spies.from).toHaveBeenCalledWith('plan_limits');
    expect(spies.eq).toHaveBeenCalledWith('plan', 'pro');
  });

  it('erro → fallback hardcoded', async () => {
    const { client } = makeFakeClient({ error: { message: 'offline' } });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getPlanLimit('pro');
    expect(out.plan).toBe('pro');
    expect(out.ai_monthly_limit).toBe(500);
  });

  it('data null → fallback hardcoded', async () => {
    const { client } = makeFakeClient({ data: null });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await getPlanLimit('free');
    expect(out.ai_monthly_limit).toBe(30);
  });
});

// ─── canUseAi ──────────────────────────────────────────────────────────────

describe('canUseAi', () => {
  it('userId vazio → allowed=false', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await canUseAi('', 'chat_ai');
    expect(out.allowed).toBe(false);
    expect(out.plan).toBe('free');
  });

  it('PRO ativo, used<limit → allowed=true plan=pro', async () => {
    const { client } = makeFakeClient({
      rpcResponses: {
        is_pro_active: { data: true },
        ai_usage_this_month: { data: 100 },
      },
      data: { plan: 'pro', ai_monthly_limit: 500, features: {} }, // getPlanLimit
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await canUseAi('u1', 'chat_ai');
    expect(out.plan).toBe('pro');
    expect(out.allowed).toBe(true);
    expect(out.used).toBe(100);
    expect(out.limit).toBe(500);
  });

  it('free user que excedeu → allowed=false', async () => {
    const { client } = makeFakeClient({
      rpcResponses: {
        is_pro_active: { data: false },
        ai_usage_this_month: { data: 31 },
      },
      data: { plan: 'free', ai_monthly_limit: 30, features: {} },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await canUseAi('u1', 'chat_ai');
    expect(out.plan).toBe('free');
    expect(out.allowed).toBe(false);
    expect(out.used).toBe(31);
    expect(out.limit).toBe(30);
  });

  it('admin → plan=admin com limite alto', async () => {
    const { client } = makeFakeClient({
      rpcResponses: {
        ai_usage_this_month: { data: 1000 },
      },
      data: { plan: 'admin', ai_monthly_limit: 99999, features: {} },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await canUseAi('admin1', 'chat_ai', { isAdmin: true });
    expect(out.plan).toBe('admin');
    expect(out.allowed).toBe(true);
    expect(out.limit).toBe(99999);
  });
});
