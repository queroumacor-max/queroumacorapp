// Tests do service lib/services/crm.ts.
// Pattern alinhado com leads.test.ts: fake supabase chainable queue-style
// (cada `then` consome o próximo `{data,error}`) pra suportar fetches que
// fazem múltiplas queries (fetchEligibleClients = jobs + quotes em paralelo).
//
// `generateDraftMessage` é testado mockando `globalThis.fetch` direto.
//
// Cobertura (10 cenários):
//   - fetchEligibleClients: painterId vazio (no-op), happy (dedup + sort),
//     erro em jobs → NetworkError.
//   - fetchFollowupInterval: happy (retorna valor do perfil), default
//     quando null, swallow de erro (retorna 12).
//   - saveFollowupInterval: happy, painterId vazio → ValidationError.
//   - generateDraftMessage: happy (devolve draft), erro de rede → NetworkError,
//     resposta não-ok → NetworkError com mensagem do backend, clientName
//     vazio → ValidationError.
//   - saveFollowUp: happy, painterId vazio → ValidationError, message vazia
//     → ValidationError, erro de banco → NetworkError.
//   - buildWhatsAppUrl: telefone curto → null, telefone OK → URL com 55 prefix.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchEligibleClients,
  fetchFollowupInterval,
  saveFollowupInterval,
  generateDraftMessage,
  saveFollowUp,
  buildWhatsAppUrl,
} from '../../lib/services/crm';
import { ValidationError, NetworkError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
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
    limit: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn(),
  };

  const responses = [...queue];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

  // maybeSingle é await-able direto (não chainable). Resolve com o próximo
  // response e devolve `{ data, error }` no shape do supabase-js.
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
    limit: (n: number) => {
      spies.limit(n);
      return chain;
    },
    update: (patch: unknown) => {
      spies.update(patch);
      return chain;
    },
    insert: (row: unknown) => {
      spies.insert(row);
      return chain;
    },
    maybeSingle: () => {
      spies.maybeSingle();
      const r = nextResponse();
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

// ─── fetchEligibleClients ──────────────────────────────────────────────────

describe('fetchEligibleClients', () => {
  it('painterId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([{ data: [] }, { data: [] }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchEligibleClients('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: deriva clientes de jobs + quotes com dedup', async () => {
    const jobs = [
      {
        id: 'j1',
        client_name: 'Maria Silva',
        service_type: 'Pintura fachada',
        scheduled_date: '2024-01-15',
        created_at: '2024-01-10T00:00:00Z',
        revenue: 1500,
      },
      {
        id: 'j2',
        client_name: 'João',
        service_type: 'Pintura interna',
        scheduled_date: '2025-06-20',
        created_at: '2025-06-15T00:00:00Z',
        revenue: 800,
      },
    ];
    const quotes = [
      {
        id: 'q1',
        client_id: null,
        client_name: 'MARIA SILVA', // mesmo cliente, casing diferente — dedup
        client_phone: '11999998888',
        client_followup_optin: true,
        service_type: 'Retoque',
        title: null,
        status: 'concluido',
        created_at: '2024-02-01T00:00:00Z',
        approved_at: '2024-02-05T00:00:00Z',
        price: 300,
      },
    ];
    const { client } = makeFakeClient([{ data: jobs }, { data: quotes }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await fetchEligibleClients('painter-1');
    // 2 clientes derivados (Maria deduplica entre jobs+quotes; João só job).
    expect(out).toHaveLength(2);
    const maria = out.find((c) => /maria/i.test(c.client_name));
    expect(maria).toBeDefined();
    // Telefone e opt-in vieram da quote.
    expect(maria!.client_phone).toBe('11999998888');
    expect(maria!.followup_optin).toBe(true);
    // Total = revenue do job + price da quote.
    expect(maria!.total_value).toBe(1800);
    // months_since calculado (não null).
    expect(maria!.months_since).not.toBeNull();
    expect(typeof maria!.months_since).toBe('number');
  });

  it('erro em jobs → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
      { data: [] },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchEligibleClients('painter-1')).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});

// ─── fetchFollowupInterval ─────────────────────────────────────────────────

describe('fetchFollowupInterval', () => {
  it('happy: retorna valor do perfil', async () => {
    const { client } = makeFakeClient([
      { data: { followup_interval_months: 18 } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFollowupInterval('painter-1');
    expect(out).toBe(18);
  });

  it('null/missing → default 12', async () => {
    const { client } = makeFakeClient([
      { data: { followup_interval_months: null } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchFollowupInterval('painter-1');
    expect(out).toBe(12);
  });

  it('erro → swallow e devolve 12 (fallback gracioso)', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'fail' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await fetchFollowupInterval('painter-1');
    expect(out).toBe(12);
    warnSpy.mockRestore();
  });
});

// ─── saveFollowupInterval ──────────────────────────────────────────────────

describe('saveFollowupInterval', () => {
  it('happy: chama update com clamp em 1..120', async () => {
    const { client, spies } = makeFakeClient([{ data: null, error: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await saveFollowupInterval('painter-1', 999);
    expect(spies.update).toHaveBeenCalledWith({ followup_interval_months: 120 });
    expect(spies.eq).toHaveBeenCalledWith('id', 'painter-1');
  });

  it('painterId vazio → ValidationError (sem rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(saveFollowupInterval('', 12)).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(spies.update).not.toHaveBeenCalled();
  });
});

// ─── generateDraftMessage ──────────────────────────────────────────────────

describe('generateDraftMessage', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch !== undefined) {
      globalThis.fetch = originalFetch;
    }
  });

  it('clientName vazio → ValidationError antes de fetch', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    await expect(
      generateDraftMessage({
        painterName: 'Joao',
        clientName: '',
        monthsAgo: 12,
        jobType: 'fachada',
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('happy path: devolve { draft } do backend', async () => {
    // Tipamos a fábrica de fetch com a assinatura exata pra que o
    // `mock.calls[0]` tenha tuple-type `[input, init]` (e não `unknown[]`).
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ draft: 'Olá Maria, tudo bem?' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const out = await generateDraftMessage({
      painterName: 'Joao',
      clientName: 'Maria',
      monthsAgo: 14,
      jobType: 'fachada',
    });
    expect(out).toEqual({ draft: 'Olá Maria, tudo bem?' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe('/api/crm-draft');
    const body = JSON.parse((init?.body as string | undefined) ?? '{}');
    expect(body.clientName).toBe('Maria');
    expect(body.monthsSince).toBe(14);
    expect(body.lastService).toBe('fachada');
  });

  it('resposta não-ok → NetworkError com mensagem do backend', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'PRO necessário' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await expect(
      generateDraftMessage({
        painterName: '',
        clientName: 'Maria',
        monthsAgo: 12,
        jobType: '',
      })
    ).rejects.toMatchObject({
      name: 'NetworkError',
      message: 'PRO necessário',
    });
  });

  it('falha de rede → NetworkError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await expect(
      generateDraftMessage({
        painterName: '',
        clientName: 'Maria',
        monthsAgo: 12,
        jobType: '',
      })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('resposta ok mas sem `draft` → NetworkError "resposta inválida"', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ foo: 'bar' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await expect(
      generateDraftMessage({
        painterName: '',
        clientName: 'Maria',
        monthsAgo: 12,
        jobType: '',
      })
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── saveFollowUp ──────────────────────────────────────────────────────────

describe('saveFollowUp', () => {
  it('happy path: insere em follow_ups com painter_id e message', async () => {
    const { client, spies } = makeFakeClient([{ data: null, error: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await saveFollowUp({
      painter_id: 'painter-1',
      message: 'Oi Maria!',
      channel: 'whatsapp',
    });
    expect(spies.from).toHaveBeenCalledWith('follow_ups');
    expect(spies.insert).toHaveBeenCalledTimes(1);
    const inserted = spies.insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted.painter_id).toBe('painter-1');
    expect(inserted.message).toBe('Oi Maria!');
    expect(inserted.status).toBe('sent');
    expect(inserted.sent_at).toBeTruthy();
  });

  it('painter_id vazio → ValidationError (sem rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      saveFollowUp({ painter_id: '', message: 'oi' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('message vazia → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      saveFollowUp({ painter_id: 'p1', message: '   ' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('erro de banco → NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      saveFollowUp({ painter_id: 'p1', message: 'oi' })
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── buildWhatsAppUrl ──────────────────────────────────────────────────────

describe('buildWhatsAppUrl', () => {
  it('telefone com 10+ dígitos + sem prefixo 55 → adiciona 55', () => {
    const url = buildWhatsAppUrl('(11) 99999-8888', 'Olá!');
    expect(url).toBe('https://wa.me/5511999998888?text=Ol%C3%A1!');
  });

  it('telefone < 10 dígitos → null', () => {
    expect(buildWhatsAppUrl('123', 'oi')).toBeNull();
    expect(buildWhatsAppUrl('', 'oi')).toBeNull();
    expect(buildWhatsAppUrl(null, 'oi')).toBeNull();
  });

  it('telefone com 13 dígitos (já E.164) → não duplica 55', () => {
    const url = buildWhatsAppUrl('5511999998888', 'msg');
    expect(url).toBe('https://wa.me/5511999998888?text=msg');
  });
});
