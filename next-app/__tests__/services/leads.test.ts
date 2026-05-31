// Tests do service lib/services/leads.ts.
// Pattern alinhado com __tests__/services/notifications.test.ts: injeta um
// fake chainable consistente com a API do supabase-js (.from().select().eq()
// .in().order().limit() → await yields { data, error }) via
// __setSupabaseForTests. Pra rpc, o chainable também serve — a chave é o
// método `rpc(name, params)` que retorna `{ data, error }`.
//
// Cobertura:
//   - fetchLeads: empty (painterId vazio), happy (filtra fora os já comprados),
//     happy sem nenhum lead, error no posts → NetworkError.
//   - comprarObra: happy → retorna { quoteId }, duplicate (23505) →
//     ValidationError, insufficient → AuthorizationError, erro genérico →
//     NetworkError.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import { fetchLeads, comprarObra } from '../../lib/services/leads';
import {
  ValidationError,
  AuthorizationError,
  NetworkError,
} from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────
// O fetchLeads faz DUAS queries em sequência (posts → quotes). O fake
// suporta isso retornando um chain que responde por then() — mas precisamos
// diferenciar os dois calls. Solução: a fábrica aceita um array de
// `{ data, error }` queue-style; cada `then` consome o próximo.

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
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
    order: vi.fn(),
    limit: vi.fn(),
    rpc: vi.fn(),
  };

  // Queue mutável: cada .then() consome o head; se vazio, devolve {null,null}
  // (caller pode setar uma queue maior pra cenários multi-query).
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
    in: (col: string, vals: unknown[]) => {
      spies.in(col, vals);
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
    // PostgrestBuilder vira await-able via `then`. Cada await consome um
    // item do queue — pra fetchLeads (2 queries) precisamos de 2 items.
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResponse();
      resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    // rpc(name, params): NÃO é chainable — retorna direto uma Promise. Aqui
    // simulamos via Promise.resolve(nextResponse()) pra bater com o supabase-js.
    rpc: (name: string, params?: Record<string, unknown>) => {
      spies.rpc(name, params);
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  return {
    client: chain,
    spies,
  };
}

beforeEach(() => {
  __resetSupabaseForTests();
  // Env vars precisam estar setadas pra getSupabase() não estourar antes do
  // __setSupabaseForTests substituir o singleton.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── fetchLeads ────────────────────────────────────────────────────────────

describe('fetchLeads', () => {
  it('painterId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([{ data: [{ id: 'p1' }] }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await fetchLeads('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('sem posts em venda → resolve [] e não consulta quotes', async () => {
    const { client, spies } = makeFakeClient([{ data: [] }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await fetchLeads('painter-1');
    expect(out).toEqual([]);
    // Só uma chamada `from` (posts), nada de quotes porque early-return.
    expect(spies.from).toHaveBeenCalledTimes(1);
    expect(spies.from).toHaveBeenCalledWith('posts');
  });

  it('happy path: filtra fora os posts já comprados pelo painter', async () => {
    const posts = [
      {
        id: 'p1',
        user_id: 'c1',
        caption: 'lead 1',
        media_url: 'x',
        media_type: 'image',
        price: 1000,
        art_type: 'fachada',
        created_at: '2026-05-31T10:00:00Z',
      },
      {
        id: 'p2',
        user_id: 'c2',
        caption: 'lead 2',
        media_url: 'y',
        media_type: 'image',
        price: 500,
        art_type: 'interna',
        created_at: '2026-05-30T10:00:00Z',
      },
      {
        id: 'p3',
        user_id: 'c3',
        caption: 'lead 3',
        media_url: 'z',
        media_type: 'image',
        price: 200,
        art_type: 'mural',
        created_at: '2026-05-29T10:00:00Z',
      },
    ];
    // p2 já foi comprada — quotes retorna { post_id: 'p2' }.
    const { client, spies } = makeFakeClient([
      { data: posts },
      { data: [{ post_id: 'p2' }] },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );

    const out = await fetchLeads('painter-1');
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.id)).toEqual(['p1', 'p3']);

    // Sanity: tocou as duas tabelas certas, com filtros esperados.
    expect(spies.from).toHaveBeenCalledWith('posts');
    expect(spies.from).toHaveBeenCalledWith('quotes');
    expect(spies.eq).toHaveBeenCalledWith('status', 'approved');
    expect(spies.eq).toHaveBeenCalledWith('for_sale', true);
    expect(spies.eq).toHaveBeenCalledWith('painter_id', 'painter-1');
    expect(spies.in).toHaveBeenCalledWith('post_id', ['p1', 'p2', 'p3']);
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(spies.limit).toHaveBeenCalledWith(30);
  });

  it('error na query de posts → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(fetchLeads('painter-1')).rejects.toBeInstanceOf(NetworkError);
  });

  it('error na query de quotes → degrada (retorna posts sem filtro)', async () => {
    const posts = [
      {
        id: 'p1',
        user_id: 'c1',
        caption: 'a',
        media_url: 'x',
        media_type: 'image',
        price: 100,
        art_type: 'x',
        created_at: '2026-05-31T10:00:00Z',
      },
    ];
    const { client } = makeFakeClient([
      { data: posts },
      { data: null, error: { message: 'quotes rls' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    // Silencia warn pra log limpo no terminal de teste.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await fetchLeads('painter-1');
    expect(out).toHaveLength(1);
    warnSpy.mockRestore();
  });
});

// ─── comprarObra ──────────────────────────────────────────────────────────

describe('comprarObra', () => {
  it('postId vazio → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(comprarObra('', 'painter-1')).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('painterId vazio → AuthorizationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(comprarObra('post-1', '')).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('happy path: chama RPC create_painter_draft e retorna quoteId', async () => {
    const { client, spies } = makeFakeClient([{ data: 'quote-uuid-123' }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    const out = await comprarObra('post-1', 'painter-1');
    expect(out).toEqual({ quoteId: 'quote-uuid-123' });
    expect(spies.rpc).toHaveBeenCalledWith('create_painter_draft', {
      p_post_id: 'post-1',
    });
  });

  it('duplicate (23505) → ValidationError', async () => {
    // Duas assertions = duas chamadas comprarObra = duas respostas no queue.
    const dupErr = { code: '23505', message: 'duplicate key' };
    const { client } = makeFakeClient([
      { data: null, error: dupErr },
      { data: null, error: dupErr },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(comprarObra('post-1', 'painter-1')).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(comprarObra('post-1', 'painter-1')).rejects.toMatchObject({
      message: 'Você já comprou este lead.',
    });
  });

  it('insufficient (pontos / PRO) → AuthorizationError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { code: 'P0001', message: 'insufficient points' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(comprarObra('post-1', 'painter-1')).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('erro genérico → NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { code: 'XX000', message: 'boom' } },
    ]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(comprarObra('post-1', 'painter-1')).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('data null na resposta → NetworkError (não retorna { quoteId: "" })', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(
      client as Parameters<typeof __setSupabaseForTests>[0]
    );
    await expect(comprarObra('post-1', 'painter-1')).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});
