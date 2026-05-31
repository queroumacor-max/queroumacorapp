// Tests do service lib/services/pipeline.ts.
// Pattern alinhado com __tests__/services/leads.test.ts: fake supabase
// chainable queue-style (cada .then() consome o próximo item de queue),
// injetado via __setSupabaseForTests. Pra `rpc`, devolve Promise direto.
//
// Pra suggestPrice (chama fetch global), mockamos `globalThis.fetch` por
// teste — não toca supabase. NetworkError/AuthorizationError do erro path
// validados via instanceof + matchObject.
//
// Cobertura (12 tests, > min 10 da spec):
//   - fetchQuotes: painterId vazio, happy path com filtros, data null, error.
//   - fetchQuote: id vazio, happy single, PGRST116 → null, error.
//   - saveQuote: ValidationError sem preço, happy → quoteId.
//   - sendQuote: happy update + filtros, error → NetworkError.
//   - approveQuote: happy (snapshot + filtros).
//   - rejectQuote: happy update.
//   - setQuoteStage: happy concluido grava completed_at, validation estágio.
//   - suggestPrice: happy, IA error (502) → NetworkError, PRO gate (403) →
//     AuthorizationError, resposta malformada → NetworkError.
//   - buildSnapshot: zera price NaN, preserva campos null.
//   - syncToJobs: noop sem quotes, idempotente (não cria duplicata).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchQuotes,
  fetchQuote,
  saveQuote,
  sendQuote,
  approveQuote,
  rejectQuote,
  setQuoteStage,
  suggestPrice,
  buildSnapshot,
  syncToJobs,
} from '../../lib/services/pipeline';
import {
  ValidationError,
  AuthorizationError,
  NetworkError,
} from '../../lib/errors';
import type { Quote } from '../../lib/types';

// ─── fake supabase chainable ───────────────────────────────────────────────

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
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
    in: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    rpc: vi.fn(),
  };

  const responses = [...queue];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

  // Toda chamada chainable devolve `chain`. `then` resolve com {data,error}
  // consumindo a head do queue — múltiplas queries em sequência consomem
  // múltiplos items (mesmo trick que leads.test.ts).
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
    in: (col: string, vals: unknown[]) => {
      spies.in(col, vals);
      return chain;
    },
    not: (col: string, op: string, val: unknown) => {
      spies.not(col, op, val);
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
    single: () => {
      spies.single();
      // single() é "terminal": retorna promise direto em vez de aceitar
      // mais chain. Casa com supabase-js real.
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    update: (patch: Record<string, unknown>) => {
      spies.update(patch);
      return chain;
    },
    insert: (payload: Record<string, unknown>) => {
      spies.insert(payload);
      return chain;
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResponse();
      resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    rpc: (name: string, params?: Record<string, unknown>) => {
      spies.rpc(name, params);
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  return { client: chain, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchQuotes ───────────────────────────────────────────────────────

describe('fetchQuotes', () => {
  it('painterId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([{ data: [{ id: 'q1' }] }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchQuotes('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna data e usa filtros corretos', async () => {
    const rows: Quote[] = [
      {
        id: 'q1',
        painter_id: 'p1',
        client_id: 'c1',
        status: 'rascunho',
        title: 'Pintura interna',
        price: 1500,
        created_at: '2026-05-31T10:00:00Z',
      },
      {
        id: 'q2',
        painter_id: 'p1',
        status: 'enviado',
        title: 'Fachada',
        price: 4000,
        created_at: '2026-05-30T10:00:00Z',
      },
    ];
    const { client, spies } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await fetchQuotes('p1');
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('quotes');
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'p1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(spies.limit).toHaveBeenCalledWith(100);
  });

  it('data null → resolve [] (não [null])', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchQuotes('p1');
    expect(out).toEqual([]);
  });

  it('error path → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchQuotes('p1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── fetchQuote ────────────────────────────────────────────────────────

describe('fetchQuote', () => {
  it('id vazio → resolve null', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchQuote('');
    expect(out).toBeNull();
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: usa single() e devolve a linha', async () => {
    const row = { id: 'q1', painter_id: 'p1', status: 'enviado', price: 100 };
    const { client, spies } = makeFakeClient([{ data: row }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchQuote('q1');
    expect(out).toEqual(row);
    expect(spies.single).toHaveBeenCalled();
    expect(spies.eq).toHaveBeenCalledWith('id', 'q1');
  });

  it('PGRST116 (no rows) → resolve null em vez de jogar', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchQuote('q-missing');
    expect(out).toBeNull();
  });

  it('error não-404 → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { code: 'XX000', message: 'boom' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchQuote('q1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── saveQuote ─────────────────────────────────────────────────────────

describe('saveQuote', () => {
  it('preço vazio/zero → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveQuote({ price: 0 })).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('happy path: chama RPC create_painter_draft com defaults e devolve quoteId', async () => {
    const { client, spies } = makeFakeClient([{ data: 'quote-uuid-1' }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await saveQuote({
      client_name: 'Maria',
      service_type: 'Pintura interna',
      area_m2: 40,
      price: 1500,
      quote_data: { itens: [{ desc: 'mão de obra', valor: 'R$ 1000' }] },
    });
    expect(out).toEqual({ quoteId: 'quote-uuid-1' });
    expect(spies.rpc).toHaveBeenCalledWith('create_painter_draft', {
      p_client_name: 'Maria',
      p_service_type: 'Pintura interna',
      p_title: 'Pintura interna',
      p_area_m2: 40,
      p_price: 1500,
      p_quote_data: { itens: [{ desc: 'mão de obra', valor: 'R$ 1000' }] },
    });
  });

  it('RPC error → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { code: 'XX000', message: 'rpc failure' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveQuote({ price: 1 })).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── sendQuote ─────────────────────────────────────────────────────────

describe('sendQuote', () => {
  it('id vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(sendQuote('', 100, 'p1')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('painterId vazio → AuthorizationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(sendQuote('q1', 100, '')).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('preço inválido → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(sendQuote('q1', 0, 'p1')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('happy path: update status=enviado + filtros', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await sendQuote('q1', 1500, 'p1');
    expect(spies.from).toHaveBeenCalledWith('quotes');
    const patch = spies.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.status).toBe('enviado');
    expect(patch.price).toBe(1500);
    expect(typeof patch.sent_at).toBe('string');
    expect(spies.eq).toHaveBeenCalledWith('id', 'q1');
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'p1');
  });

  it('error path → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(sendQuote('q1', 100, 'p1')).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});

// ─── approveQuote ──────────────────────────────────────────────────────

describe('approveQuote', () => {
  it('happy path: grava status=aprovado + snapshot + approval_method=manual', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const q: Quote = {
      id: 'q1',
      painter_id: 'p1',
      service_type: 'Pintura',
      title: 'Pintura interna',
      price: 1500,
    };
    await approveQuote('q1', q, 'p1', '  Aceito por WhatsApp  ');
    const patch = spies.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.status).toBe('aprovado');
    expect(patch.approval_method).toBe('manual');
    // String trimada — espaços não chegam ao banco.
    expect(patch.approval_note).toBe('Aceito por WhatsApp');
    expect(patch.approved_by).toBe('p1');
    expect(patch.scope_snapshot).toMatchObject({
      service_type: 'Pintura',
      title: 'Pintura interna',
      price: 1500,
    });
  });

  it('note vazia/null vira null no patch (não string vazia)', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await approveQuote('q1', { id: 'q1', painter_id: 'p1' } as Quote, 'p1', '');
    const patch = spies.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.approval_note).toBeNull();
  });
});

// ─── rejectQuote ───────────────────────────────────────────────────────

describe('rejectQuote', () => {
  it('happy path: update status=recusado + filtros', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await rejectQuote('q1', 'p1');
    const patch = spies.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).toEqual({ status: 'recusado' });
    expect(spies.eq).toHaveBeenCalledWith('id', 'q1');
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'p1');
  });
});

// ─── setQuoteStage ─────────────────────────────────────────────────────

describe('setQuoteStage', () => {
  it('estágio inválido → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      setQuoteStage(
        'q1',
        'aprovado' as unknown as 'em_execucao',
        'p1'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('em_execucao: update sem completed_at', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await setQuoteStage('q1', 'em_execucao', 'p1');
    const patch = spies.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.status).toBe('em_execucao');
    expect(patch.completed_at).toBeUndefined();
  });

  it('concluido: update com completed_at preenchido', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await setQuoteStage('q1', 'concluido', 'p1');
    const patch = spies.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.status).toBe('concluido');
    expect(typeof patch.completed_at).toBe('string');
  });
});

// ─── suggestPrice ──────────────────────────────────────────────────────

describe('suggestPrice', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('happy path: retorna { price, justification } e bate no endpoint certo', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        price: 1800,
        justification: '40m² x R$45/m² + tinta',
      }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const out = await suggestPrice({
      service_type: 'Pintura interna',
      description: 'Casa de 2 quartos',
      area_m2: 40,
    });
    expect(out).toEqual({
      price: 1800,
      justification: '40m² x R$45/m² + tinta',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/pricing-suggest',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('403 (PRO gate) → AuthorizationError com mensagem do backend', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'PRO necessário' }),
    }) as unknown as typeof globalThis.fetch;
    await expect(
      suggestPrice({ service_type: 'x' })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('502 (IA off) → NetworkError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'IA não configurada' }),
    }) as unknown as typeof globalThis.fetch;
    await expect(
      suggestPrice({ service_type: 'x' })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('resposta sem `price` numérico → NetworkError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ price: 'NaN-string', justification: 'oops' }),
    }) as unknown as typeof globalThis.fetch;
    await expect(
      suggestPrice({ service_type: 'x' })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('falha de rede (fetch throws) → NetworkError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as
      unknown as typeof globalThis.fetch;
    await expect(
      suggestPrice({ service_type: 'x' })
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── buildSnapshot ─────────────────────────────────────────────────────

describe('buildSnapshot', () => {
  it('preserva campos definidos e normaliza price NaN → 0', async () => {
    const snap = buildSnapshot({
      id: 'q1',
      painter_id: 'p1',
      service_type: 'Pintura',
      title: null,
      area_m2: 30,
      address: 'R. X, 100',
      description: 'Tudo branco',
      price: NaN as unknown as number,
      proposed_date: '2026-06-15',
      quote_data: { extra: true },
    });
    expect(snap.service_type).toBe('Pintura');
    expect(snap.area_m2).toBe(30);
    expect(snap.address).toBe('R. X, 100');
    expect(snap.price).toBe(0);
    expect(snap.proposed_date).toBe('2026-06-15');
    expect(snap.quote_data).toEqual({ extra: true });
    expect(typeof snap.frozen_at).toBe('string');
  });

  it('campos faltando viram null (não undefined)', async () => {
    const snap = buildSnapshot({ id: 'q1', painter_id: 'p1' });
    expect(snap.service_type).toBeNull();
    expect(snap.title).toBeNull();
    expect(snap.area_m2).toBeNull();
    expect(snap.address).toBeNull();
    expect(snap.description).toBeNull();
    expect(snap.proposed_date).toBeNull();
    expect(snap.quote_data).toBeNull();
    expect(snap.price).toBe(0);
  });
});

// ─── syncToJobs ────────────────────────────────────────────────────────

describe('syncToJobs', () => {
  it('painterId vazio → noop', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await syncToJobs('');
    expect(out).toEqual({ created: 0, updated: 0 });
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('sem quotes no estado terminal → noop', async () => {
    const { client, spies } = makeFakeClient([{ data: [] }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await syncToJobs('p1');
    expect(out).toEqual({ created: 0, updated: 0 });
    // Só tocou em quotes (1 from), não em jobs.
    expect(spies.from).toHaveBeenCalledTimes(1);
    expect(spies.from).toHaveBeenCalledWith('quotes');
  });

  it('idempotente: quote já tem job → não cria duplicata', async () => {
    // 1ª query: 1 quote aprovada. 2ª query: 1 job apontando pra essa quote.
    const { client, spies } = makeFakeClient([
      {
        data: [
          {
            id: 'q1',
            client_name: 'Maria',
            service_type: 'Pintura',
            address: null,
            price: 1500,
            proposed_date: '2026-06-15',
            status: 'aprovado',
          },
        ],
      },
      {
        data: [{ id: 'job-1', quote_id: 'q1', status: 'agendado' }],
      },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await syncToJobs('p1');
    expect(out).toEqual({ created: 0, updated: 0 });
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('cria job pra quote aprovada sem job existente', async () => {
    const { client, spies } = makeFakeClient([
      {
        data: [
          {
            id: 'q1',
            client_name: 'Maria',
            service_type: 'Pintura',
            address: 'R. X, 100',
            price: 1500,
            proposed_date: '2026-06-15',
            status: 'aprovado',
          },
        ],
      },
      { data: [] }, // jobs vazio
      { data: null }, // insert OK
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await syncToJobs('p1');
    expect(out.created).toBe(1);
    expect(spies.insert).toHaveBeenCalledTimes(1);
    const payload = spies.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.painter_id).toBe('p1');
    expect(payload.quote_id).toBe('q1');
    expect(payload.revenue).toBe(1500);
    expect(payload.status).toBe('agendado');
  });

  it('atualiza job pra concluido quando quote concluida e job não-cancelado', async () => {
    const { client, spies } = makeFakeClient([
      {
        data: [
          {
            id: 'q2',
            client_name: 'José',
            service_type: 'Pintura',
            price: 800,
            status: 'concluido',
          },
        ],
      },
      { data: [{ id: 'job-2', quote_id: 'q2', status: 'em_andamento' }] },
      { data: null }, // update OK
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await syncToJobs('p1');
    expect(out.updated).toBe(1);
    expect(spies.update).toHaveBeenCalledWith({ status: 'concluido' });
  });
});
