// __tests__/api/cidades.test.ts — testes do route handler `/api/cidades`.
// Cobre: UF inválida → 400, IBGE 200 → mapeia campos, IBGE 500 → 502,
// timeout/abort → 504. Mocka `fetch` global pra evitar bater no IBGE real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;

function mkReq(qs: string): NextRequest {
  // O route handler usa `request.nextUrl.searchParams`. `NextRequest` aceita
  // uma `Request` padrão como entrada — Next adiciona `.nextUrl` no construtor.
  // No vitest sem o runtime do Next, importamos `NextRequest` direto.
  const { NextRequest } = require('next/server');
  return new NextRequest(`https://app.test/api/cidades${qs}`);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GET /api/cidades', () => {
  it('returns 400 for missing UF', async () => {
    const { GET } = await import('@/app/api/cidades/route');
    const res = await GET(mkReq(''));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/UF/i);
  });

  it('returns 400 for invalid UF (not in whitelist)', async () => {
    const { GET } = await import('@/app/api/cidades/route');
    const res = await GET(mkReq('?uf=ZZ'));
    expect(res.status).toBe(400);
  });

  it('returns cidades list from IBGE on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ nome: 'São Paulo' }, { nome: 'Campinas' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { GET } = await import('@/app/api/cidades/route');
    const res = await GET(mkReq('?uf=SP'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('BYPASS');
    const body = await res.json();
    expect(body.uf).toBe('SP');
    expect(body.cidades).toEqual([{ nome: 'São Paulo' }, { nome: 'Campinas' }]);
  });

  it('returns 502 with retry-after when IBGE fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    const { GET } = await import('@/app/api/cidades/route');
    const res = await GET(mkReq('?uf=rj'));
    expect(res.status).toBe(502);
    expect(res.headers.get('retry-after')).toBe('60');
    const body = await res.json();
    expect(body.error).toMatch(/IBGE/);
  });

  it('returns 504 on IBGE timeout', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);
    const { GET } = await import('@/app/api/cidades/route');
    const res = await GET(mkReq('?uf=MG'));
    expect(res.status).toBe(504);
    expect(res.headers.get('retry-after')).toBe('30');
  });
});
