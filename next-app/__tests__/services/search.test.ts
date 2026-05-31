// Tests do service lib/services/search.ts.
// Cobertura (6 testes):
//   1. searchAll: query vazia → [] sem bater na rede;
//   2. searchAll: query só whitespace → [] sem bater na rede;
//   3. searchAll: query < 2 chars (trim) → [] sem bater na rede;
//   4. searchAll: happy path — passa args certos pra rpc, devolve data;
//   5. searchAll: error do rpc → joga Error com a message do supabase;
//   6. searchAll: data null → retorna [] (degradação graciosa);
//   7. searchAll: limit custom propagado pro RPC.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import { searchAll, type SearchResult } from '../../lib/services/search';

// ─── fake supabase client com spy em .rpc() ────────────────────────────────

interface RpcCallArgs {
  fn: string;
  args: Record<string, unknown>;
}

interface FakeOpts {
  data?: SearchResult[] | null;
  error?: { message: string } | null;
}

function makeFakeClient(opts: FakeOpts = {}): {
  client: unknown;
  rpcSpy: ReturnType<typeof vi.fn>;
  calls: RpcCallArgs[];
} {
  const calls: RpcCallArgs[] = [];
  const rpcSpy = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { data: opts.data ?? null, error: opts.error ?? null };
  });
  return { client: { rpc: rpcSpy }, rpcSpy, calls };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── searchAll ─────────────────────────────────────────────────────────────

describe('searchAll', () => {
  it('query vazia → resolve [] sem bater na rede', async () => {
    const { client, rpcSpy } = makeFakeClient({ data: [] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await searchAll('');
    expect(out).toEqual([]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('query só whitespace → resolve [] sem bater na rede', async () => {
    const { client, rpcSpy } = makeFakeClient({ data: [] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await searchAll('   ');
    expect(out).toEqual([]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('query com 1 char (após trim) → resolve [] sem bater na rede', async () => {
    const { client, rpcSpy } = makeFakeClient({ data: [] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await searchAll(' a ');
    expect(out).toEqual([]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('happy path: chama rpc("search_all", {p_query, p_limit}) e retorna data', async () => {
    const rows: SearchResult[] = [
      { result_type: 'profile', id: 'p1', title: 'João Pintor', snippet: '<b>joão</b> pintor de fachadas', score: 0.42 },
      { result_type: 'post', id: 'po1', title: 'Pintura nova', snippet: 'minha <b>pintura</b>...', score: 0.31 },
      { result_type: 'product', id: 'pr1', title: 'Tinta látex', snippet: 'tinta <b>látex</b> branca', score: 0.18 },
    ];
    const { client, rpcSpy, calls } = makeFakeClient({ data: rows });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await searchAll('pintura');
    expect(out).toEqual(rows);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(calls[0]?.fn).toBe('search_all');
    expect(calls[0]?.args).toEqual({ p_query: 'pintura', p_limit: 20 });
  });

  it('error do rpc → joga Error com a message do supabase', async () => {
    const { client } = makeFakeClient({
      data: null,
      error: { message: 'function search_all does not exist' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(searchAll('xyz')).rejects.toThrow('function search_all does not exist');
  });

  it('data null com error null → resolve [] (degradação graciosa)', async () => {
    const { client } = makeFakeClient({ data: null, error: null });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await searchAll('qualquer');
    expect(out).toEqual([]);
  });

  it('limit custom é propagado pro RPC', async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await searchAll('pintor', 5);
    expect(calls[0]?.args).toEqual({ p_query: 'pintor', p_limit: 5 });
  });

  it('trima a query antes de mandar ao RPC', async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await searchAll('  pintura  ');
    expect(calls[0]?.args.p_query).toBe('pintura');
  });
});
