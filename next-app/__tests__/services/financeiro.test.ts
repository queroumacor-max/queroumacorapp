// Tests do service lib/services/financeiro.ts.
// Pattern alinhado com __tests__/services/{leads,pedidos,notifications}.test.ts:
// fake supabase chainable injetado via __setSupabaseForTests, queue-based pra
// suportar múltiplas queries sequenciais. Mocka `fetch` global pra cobrir
// analyzeWithAI sem chamar a /api/fin-analysis real.
//
// Cobertura (10 testes total):
//   - fetchEntries: painterId vazio → [], happy path com filtros (painter,
//     status concluido, cutoff, order, limit), error → NetworkError,
//     data null → [], monthsBack <= 0 → ValidationError.
//   - createEntry: faltando service_type e client_name → ValidationError;
//     valores zero → ValidationError; happy path → grava jobs com
//     status=concluido + scheduled_date local.
//   - deleteEntry: id vazio → ValidationError; happy path → delete com
//     painter_id check redundante.
//   - getMonthSummary: agrega correto incluindo nulls/strings.
//   - analyzeWithAI: happy path; backend !ok → NetworkError com mensagem;
//     resposta sem `analysis` → NetworkError.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchEntries,
  createEntry,
  deleteEntry,
  getMonthSummary,
  analyzeWithAI,
} from '../../lib/services/financeiro';
import { NetworkError, ValidationError } from '../../lib/errors';
import type { Job } from '../../lib/types';

// ─── fake supabase chainable ───────────────────────────────────────────────

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
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
    gte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    single: vi.fn(),
  };

  const responses = [...queue];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

  // `chain` é monomorfic — todo método retorna o próprio chain pra suportar
  // composição em qualquer ordem (.from().select().eq().gte().order().limit()
  // ou .from().insert().select().single(), etc.). then() consome o head do
  // queue pra tornar o builder await-able.
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
    gte: (col: string, val: unknown) => {
      spies.gte(col, val);
      return chain;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      spies.order(col, opts);
      return chain;
    },
    limit: (n: number) => {
      spies.limit(n);
      return chain;
    },
    insert: (row: unknown) => {
      spies.insert(row);
      return chain;
    },
    delete: () => {
      spies.delete();
      return chain;
    },
    single: () => {
      spies.single();
      const r = nextResponse();
      // .single() retorna Promise direto (não chainable) — mesmo padrão da
      // API real do supabase-js.
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
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

// ─── fetchEntries ──────────────────────────────────────────────────────────

describe('fetchEntries', () => {
  it('painterId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([{ data: [{ id: 'j1' }] }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await fetchEntries('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna data e aplica filtros (painter, status, cutoff, order, limit)', async () => {
    const rows: Job[] = [
      {
        id: 'j1',
        painter_id: 'p1',
        status: 'concluido',
        service_type: 'Pintura cozinha',
        client_name: 'João',
        revenue: 1000,
        material_cost: 300,
        created_at: '2026-05-31T10:00:00Z',
      },
    ];
    const { client, spies } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );

    const out = await fetchEntries('p1', 6);
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('jobs');
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'p1');
    expect(spies.eq).toHaveBeenCalledWith('status', 'concluido');
    expect(spies.gte).toHaveBeenCalled();
    // Cutoff é uma ISO string — sanity check de formato.
    const gteCall = spies.gte.mock.calls[0];
    expect(gteCall[0]).toBe('created_at');
    expect(String(gteCall[1])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(spies.limit).toHaveBeenCalledWith(500);
  });

  it('data null → resolve [] (não [null])', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await fetchEntries('p1');
    expect(out).toEqual([]);
  });

  it('error path → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(fetchEntries('p1')).rejects.toBeInstanceOf(NetworkError);
  });

  it('monthsBack <= 0 → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(fetchEntries('p1', 0)).rejects.toBeInstanceOf(ValidationError);
    await expect(fetchEntries('p1', -1)).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });
});

// ─── createEntry ──────────────────────────────────────────────────────────

describe('createEntry', () => {
  it('sem service_type nem client_name → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createEntry('p1', {
        service_type: '   ',
        client_name: '',
        revenue: 100,
        material_cost: 0,
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('revenue=0 e material_cost=0 → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createEntry('p1', {
        service_type: 'Pintura',
        revenue: 0,
        material_cost: 0,
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: insere job com status=concluido + scheduled_date local', async () => {
    const created: Job = {
      id: 'j1',
      painter_id: 'p1',
      status: 'concluido',
      service_type: 'Pintura',
      client_name: '-',
      revenue: 500,
      material_cost: 100,
      created_at: '2026-05-31T10:00:00Z',
    };
    const { client, spies } = makeFakeClient([{ data: created }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );

    const out = await createEntry('p1', {
      service_type: 'Pintura',
      revenue: 500,
      material_cost: 100,
    });
    expect(out).toEqual(created);
    expect(spies.from).toHaveBeenCalledWith('jobs');
    expect(spies.insert).toHaveBeenCalledTimes(1);
    const row = spies.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.painter_id).toBe('p1');
    expect(row.service_type).toBe('Pintura');
    expect(row.client_name).toBe('-');
    expect(row.revenue).toBe(500);
    expect(row.material_cost).toBe(100);
    expect(row.status).toBe('concluido');
    // scheduled_date é YYYY-MM-DD local — sanity de formato.
    expect(String(row.scheduled_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(spies.single).toHaveBeenCalled();
  });

  it('valor negativo é clampado pra zero antes de validar', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    // Ambos negativos → clamp pra 0 → ValidationError.
    await expect(
      createEntry('p1', {
        service_type: 'X',
        revenue: -50,
        material_cost: -20,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── deleteEntry ──────────────────────────────────────────────────────────

describe('deleteEntry', () => {
  it('id vazio → ValidationError sem tocar rede', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(deleteEntry('', 'p1')).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: chama delete + eq painter_id (defesa em camadas)', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await deleteEntry('j1', 'p1');
    expect(spies.from).toHaveBeenCalledWith('jobs');
    expect(spies.delete).toHaveBeenCalled();
    expect(spies.eq).toHaveBeenCalledWith('id', 'j1');
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'p1');
  });
});

// ─── getMonthSummary ──────────────────────────────────────────────────────

describe('getMonthSummary', () => {
  it('soma receita/custos/lucro e ignora nulls', () => {
    const entries: Job[] = [
      {
        id: 'j1',
        painter_id: 'p1',
        status: 'concluido',
        revenue: 1000,
        material_cost: 300,
        created_at: '2026-05-31T10:00:00Z',
      },
      {
        id: 'j2',
        painter_id: 'p1',
        status: 'concluido',
        revenue: 500,
        material_cost: null,
        created_at: '2026-05-30T10:00:00Z',
      },
      {
        id: 'j3',
        painter_id: 'p1',
        status: 'concluido',
        revenue: null,
        material_cost: 200,
        created_at: '2026-05-29T10:00:00Z',
      },
    ];
    const sum = getMonthSummary(entries);
    expect(sum.receita).toBe(1500);
    expect(sum.custos).toBe(500);
    expect(sum.lucro).toBe(1000);
    expect(sum.count).toBe(3);
  });

  it('array vazio → tudo zero', () => {
    const sum = getMonthSummary([]);
    expect(sum).toEqual({ receita: 0, custos: 0, lucro: 0, count: 0 });
  });

  it('lucro negativo quando custos > receita', () => {
    const entries: Job[] = [
      {
        id: 'j1',
        painter_id: 'p1',
        status: 'concluido',
        revenue: 100,
        material_cost: 500,
        created_at: '2026-05-31T10:00:00Z',
      },
    ];
    const sum = getMonthSummary(entries);
    expect(sum.lucro).toBe(-400);
  });
});

// ─── analyzeWithAI ────────────────────────────────────────────────────────

describe('analyzeWithAI', () => {
  // Salva fetch original pra restaurar entre testes — vitest não isola globals.
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const samplePayload = {
    thisMonth: { receita: 1000, custos: 300, lucro: 700, count: 2 },
    lastMonth: { receita: 800, custos: 400, lucro: 400, count: 3 },
    recentJobs: [],
  };

  it('happy path: retorna { analysis } quando backend ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ analysis: 'Receita subiu 25%...' }),
    }) as unknown as typeof fetch;

    const out = await analyzeWithAI(samplePayload);
    expect(out).toEqual({ analysis: 'Receita subiu 25%...' });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/fin-analysis',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('backend !ok com error string → NetworkError com mensagem do backend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'PRO necessário' }),
    }) as unknown as typeof fetch;

    await expect(analyzeWithAI(samplePayload)).rejects.toBeInstanceOf(
      NetworkError
    );
    await expect(analyzeWithAI(samplePayload)).rejects.toMatchObject({
      message: 'PRO necessário',
    });
  });

  it('resposta ok mas sem analysis → NetworkError "resposta inválida"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    await expect(analyzeWithAI(samplePayload)).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('fetch joga (rede off) → NetworkError', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;
    await expect(analyzeWithAI(samplePayload)).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});
