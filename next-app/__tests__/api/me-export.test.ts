// __tests__/api/me-export.test.ts — testes do route handler `/api/me-export`.
// Cobre: 401 sem token, 503 sem service key, 200 com export completo + content-disposition,
// fan-out de 16 queries quando há service key.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://app.test/api/me-export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/me-export', () => {
  it('returns 401 when no token provided', async () => {
    const { POST } = await import('@/app/api/me-export/route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(401);
  });

  it('returns 503 when token valid but no service key configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'user-1', email: 'u@x.com' }), { status: 200 })
    );
    const { POST } = await import('@/app/api/me-export/route');
    const res = await POST(mkReq({}, { Authorization: 'Bearer good-token' }));
    expect(res.status).toBe(503);
  });

  it('returns 200 with JSON export + content-disposition when authed & service key present', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      calls++;
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'uuid-12345678', email: 'u@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      // All export queries return []
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/me-export/route');
    const res = await POST(mkReq({}, { Authorization: 'Bearer good-token' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('uuid-123');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body._meta.lgpd_article).toMatch(/Art\. 18 V/);
    expect(body._meta.user_id).toBe('uuid-12345678');
    expect(body._meta.email).toBe('u@x.com');
    // 16 export queries + auth + rate-limit RPC = 18 calls
    expect(calls).toBeGreaterThanOrEqual(17);
  });

  it('returns 429 when rate limit blocks', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'uid', email: 'u@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ allowed: false, count: 4, limit: 3, retry_after_seconds: 30 }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/me-export/route');
    const res = await POST(mkReq({}, { Authorization: 'Bearer good-token' }));
    expect(res.status).toBe(429);
  });
});
