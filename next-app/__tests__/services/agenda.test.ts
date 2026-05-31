// Tests do service lib/services/agenda.ts.
// Pattern alinhado com leads.test.ts / pedidos.test.ts: injeta um fake
// chainable consistente com a API do supabase-js (.from().select().eq()
// .gte().lt().order().limit().insert().update() → await yields {data,error})
// via __setSupabaseForTests. Pra optimizeDayOrder, mocka global.fetch.
//
// Cobertura (mínimo 8 testes pedidos):
//   1. fetchJobsByMonth empty (painterId vazio) → []
//   2. fetchJobsByMonth happy → retorna rows + filtra por intervalo correto
//   3. fetchJobsByMonth ano inválido → ValidationError
//   4. fetchJobsByMonth mês inválido → ValidationError
//   5. fetchJobsByMonth erro supabase → NetworkError
//   6. createJob client_name vazio → ValidationError
//   7. createJob happy → retorna row inserido com painter_id correto
//   8. createJob painterId vazio → ValidationError
//   9. updateJobStatus happy → resolve void + filtros corretos
//  10. updateJobStatus jobId vazio → ValidationError
//  11. optimizeDayOrder menos de 2 jobs → ValidationError
//  12. optimizeDayOrder happy → retorna ordered_ids + notes
//  13. optimizeDayOrder erro do backend → NetworkError com mensagem
//  14. optimizeDayOrder resposta sem ordered_ids → NetworkError

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchJobsByMonth,
  createJob,
  updateJobStatus,
  optimizeDayOrder,
} from '../../lib/services/agenda';
import { ValidationError, NetworkError } from '../../lib/errors';
import type { Job } from '../../lib/types';

// ─── fake supabase chainable ───────────────────────────────────────────────
// Cada método retorna `chain` pra permitir composição em qualquer ordem.
// Pra .insert(...).select(...).single() / .update().eq().eq(), suporta tudo.

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
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
    gte: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
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
    gte: (col: string, val: unknown) => {
      spies.gte(col, val);
      return chain;
    },
    lt: (col: string, val: unknown) => {
      spies.lt(col, val);
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
    update: (patch: unknown) => {
      spies.update(patch);
      return chain;
    },
    // .single() resolve a query antes do await — consome um item do queue.
    single: () => {
      spies.single();
      const r = nextResponse();
      return Promise.resolve({
        data: r.data ?? null,
        error: r.error ?? null,
      });
    },
    // PostgrestBuilder vira await-able via `then`. Cada await consome um item.
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

// ─── fetchJobsByMonth ──────────────────────────────────────────────────────

describe('fetchJobsByMonth', () => {
  it('painterId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([{ data: [{ id: 'j1' }] }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await fetchJobsByMonth('', 2026, 5);
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna data e usa intervalo correto [primeiro do mês, primeiro do próximo)', async () => {
    const rows: Job[] = [
      {
        id: 'j1',
        painter_id: 'painter-1',
        status: 'agendado',
        client_name: 'Cliente A',
        scheduled_date: '2026-05-10',
        scheduled_time: '14:30',
        address: 'Rua X, 100',
        service_type: 'Pintura externa',
        revenue: 1500,
        material_cost: 300,
        created_at: '2026-05-01T10:00:00Z',
      },
      {
        id: 'j2',
        painter_id: 'painter-1',
        status: 'concluido',
        client_name: 'Cliente B',
        scheduled_date: '2026-05-20',
        scheduled_time: '09:00',
        address: 'Av Y, 200',
        service_type: 'Reforma',
        revenue: 2500,
        material_cost: 500,
        created_at: '2026-05-15T10:00:00Z',
      },
    ];
    const { client, spies } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );

    const out = await fetchJobsByMonth('painter-1', 2026, 5);
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('jobs');
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'painter-1');
    // Maio 2026: gte 2026-05-01, lt 2026-06-01.
    expect(spies.gte).toHaveBeenCalledWith('scheduled_date', '2026-05-01');
    expect(spies.lt).toHaveBeenCalledWith('scheduled_date', '2026-06-01');
    expect(spies.order).toHaveBeenCalledWith('scheduled_date', {
      ascending: true,
    });
    expect(spies.limit).toHaveBeenCalledWith(500);
  });

  it('dezembro → janeiro do ano seguinte (overflow de mês)', async () => {
    const { client, spies } = makeFakeClient([{ data: [] }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await fetchJobsByMonth('painter-1', 2026, 12);
    // Dez 2026: gte 2026-12-01, lt 2027-01-01.
    expect(spies.gte).toHaveBeenCalledWith('scheduled_date', '2026-12-01');
    expect(spies.lt).toHaveBeenCalledWith('scheduled_date', '2027-01-01');
  });

  it('ano inválido (não inteiro) → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      fetchJobsByMonth('painter-1', 1969, 5)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('mês inválido (fora de 1-12) → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      fetchJobsByMonth('painter-1', 2026, 13)
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      fetchJobsByMonth('painter-1', 2026, 0)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('data null → resolve [] (não [null])', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await fetchJobsByMonth('painter-1', 2026, 5);
    expect(out).toEqual([]);
  });

  it('erro Supabase → joga NetworkError com message', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      fetchJobsByMonth('painter-1', 2026, 5)
    ).rejects.toBeInstanceOf(NetworkError);
    await expect(
      fetchJobsByMonth('painter-1', 2026, 5)
    ).rejects.toMatchObject({ message: 'rls bloqueou' });
  });
});

// ─── createJob ─────────────────────────────────────────────────────────────

describe('createJob', () => {
  it('painterId vazio → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createJob('', { client_name: 'Cliente A' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('client_name vazio → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createJob('painter-1', { client_name: '   ' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: insere com painter_id correto e retorna o row', async () => {
    const created: Job = {
      id: 'j-new',
      painter_id: 'painter-1',
      status: 'agendado',
      client_name: 'Novo Cliente',
      scheduled_date: '2026-05-15',
      scheduled_time: '10:00',
      address: 'Rua Z, 50',
      service_type: 'Pintura',
      revenue: 1000,
      material_cost: 200,
      created_at: '2026-05-10T10:00:00Z',
    };
    const { client, spies } = makeFakeClient([{ data: created }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );

    const out = await createJob('painter-1', {
      client_name: '  Novo Cliente  ',
      service_type: 'Pintura',
      scheduled_date: '2026-05-15',
      scheduled_time: '10:00',
      address: 'Rua Z, 50',
      revenue: 1000,
      material_cost: 200,
    });

    expect(out).toEqual(created);
    expect(spies.from).toHaveBeenCalledWith('jobs');
    // Verifica trim no client_name + painter_id injetado pelo service.
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        painter_id: 'painter-1',
        client_name: 'Novo Cliente',
        scheduled_date: '2026-05-15',
        revenue: 1000,
      })
    );
    expect(spies.single).toHaveBeenCalled();
  });

  it('erro Supabase no insert → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'fk violation' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createJob('painter-1', { client_name: 'Cliente A' })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('insert retorna data null → NetworkError (defensivo)', async () => {
    const { client } = makeFakeClient([{ data: null, error: null }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      createJob('painter-1', { client_name: 'Cliente A' })
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── updateJobStatus ───────────────────────────────────────────────────────

describe('updateJobStatus', () => {
  it('jobId vazio → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      updateJobStatus('', 'painter-1', 'concluido')
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('painterId vazio → ValidationError', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      updateJobStatus('j1', '', 'concluido')
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: update com painter_id como segunda eq (defesa em camadas)', async () => {
    const { client, spies } = makeFakeClient([{ data: null, error: null }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await updateJobStatus('j1', 'painter-1', 'concluido');
    expect(spies.from).toHaveBeenCalledWith('jobs');
    expect(spies.update).toHaveBeenCalledWith({ status: 'concluido' });
    expect(spies.eq).toHaveBeenCalledWith('id', 'j1');
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'painter-1');
  });

  it('erro Supabase no update → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'check constraint' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(
      updateJobStatus('j1', 'painter-1', 'cancelado')
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── optimizeDayOrder ──────────────────────────────────────────────────────
// Mocka global.fetch — esse path não toca em supabase.

describe('optimizeDayOrder', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeJob(id: string, time: string, addr: string): Job {
    return {
      id,
      painter_id: 'painter-1',
      status: 'agendado',
      client_name: `Cliente ${id}`,
      scheduled_date: '2026-05-15',
      scheduled_time: time,
      address: addr,
    };
  }

  it('data vazia → ValidationError (não toca na rede)', async () => {
    await expect(
      optimizeDayOrder('', [makeJob('a', '09:00', 'X'), makeJob('b', '10:00', 'Y')])
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('menos de 2 jobs → ValidationError (não toca na rede)', async () => {
    await expect(
      optimizeDayOrder('2026-05-15', [makeJob('a', '09:00', 'X')])
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('happy path: POST /api/agenda-order com payload correto e retorna ordered_ids + notes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ordered_ids: ['b', 'a'],
        notes: 'Comece pelo centro.',
      }),
    });
    const jobs = [
      makeJob('a', '09:00', 'Endereço A'),
      makeJob('b', '10:30', 'Endereço B'),
    ];
    const out = await optimizeDayOrder('2026-05-15', jobs);
    expect(out).toEqual({
      ordered_ids: ['b', 'a'],
      notes: 'Comece pelo centro.',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/agenda-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-05-15',
        jobs: [
          {
            id: 'a',
            client_name: 'Cliente a',
            address: 'Endereço A',
            scheduled_time: '09:00',
          },
          {
            id: 'b',
            client_name: 'Cliente b',
            address: 'Endereço B',
            scheduled_time: '10:30',
          },
        ],
      }),
    });
  });

  it('backend retorna 503 → NetworkError com a mensagem do JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'IA não configurada' }),
    });
    await expect(
      optimizeDayOrder('2026-05-15', [
        makeJob('a', '09:00', 'X'),
        makeJob('b', '10:00', 'Y'),
      ])
    ).rejects.toMatchObject({
      message: 'IA não configurada',
    });
  });

  it('resposta sem ordered_ids → NetworkError "Resposta inválida"', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ notes: 'só notas' }),
    });
    await expect(
      optimizeDayOrder('2026-05-15', [
        makeJob('a', '09:00', 'X'),
        makeJob('b', '10:00', 'Y'),
      ])
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('fetch estoura → NetworkError "Falha de rede"', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await expect(
      optimizeDayOrder('2026-05-15', [
        makeJob('a', '09:00', 'X'),
        makeJob('b', '10:00', 'Y'),
      ])
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
