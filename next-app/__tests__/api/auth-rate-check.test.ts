// __tests__/api/auth-rate-check.test.ts — testes do route handler.
// Cobre: action default=login, action whitelisted (signup/reset/unknown),
// rate-limit allowed (fail-open sem service key) e blocked (429).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://app.test/api/auth-rate-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/auth-rate-check', () => {
  it('returns allowed=true with action=login (default), skipped without service key', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    const { POST } = await import('@/app/api/auth-rate-check/route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.action).toBe('login');
    expect(body.limit).toBe(10);
    expect(body.skipped).toBe(true);
  });

  it('falls back to login when action is unknown, returns proper limit for signup', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { POST } = await import('@/app/api/auth-rate-check/route');
    const r1 = await POST(mkReq({ action: 'pwnyou' }));
    expect((await r1.json()).action).toBe('login');
    const r2 = await POST(mkReq({ action: 'signup' }));
    const b2 = await r2.json();
    expect(b2.action).toBe('signup');
    expect(b2.limit).toBe(5);
  });

  it('returns 429 with retry-after when RPC says blocked', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ allowed: false, count: 11, limit: 10, retry_after_seconds: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { POST } = await import('@/app/api/auth-rate-check/route');
    const res = await POST(mkReq({ action: 'login' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
  });

  it('OPTIONS returns 204', async () => {
    const { OPTIONS } = await import('@/app/api/auth-rate-check/route');
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});
