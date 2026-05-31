// __tests__/api/health.test.ts — testes do route handler `/api/health`.
// Mocka fetch global pra controlar resposta do Supabase liveness check.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('GET /api/health', () => {
  it('returns 200 with status=ok payload (no SUPABASE_URL → supabase=false)', async () => {
    delete process.env.SUPABASE_URL;
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.app).toBe('queroumacorapp');
    expect(typeof body.time).toBe('string');
    expect(body.supabase).toBe(false);
  });

  it('sets no-store cache-control', async () => {
    delete process.env.SUPABASE_URL;
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('reports supabase=true when REST root responds (any status > 0)', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-test';
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();
    expect(body.supabase).toBe(true);
  });

  it('reports supabase=false on fetch rejection (timeout/network)', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();
    expect(body.supabase).toBe(false);
  });
});
