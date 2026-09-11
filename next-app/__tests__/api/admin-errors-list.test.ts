// __tests__/api/admin-errors-list.test.ts — testes do route handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://app.test/api/admin/errors-list', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.ADMIN_EMAILS = 'boss@x.com,sec@x.com';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/admin/errors-list', () => {
  it('admin happy path: returns rows + total', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller-1', email: 'BOSS@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/errors')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
            status: 200,
            headers: { 'content-range': '0-1/42' },
          })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/errors-list/route');
    const res = await POST(mkReq({ accessToken: 'good' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBe(2);
    expect(body.total).toBe(42);
  });

  it('missing token returns 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const { POST } = await import('@/app/api/admin/errors-list/route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(401);
  });

  it('non-admin email returns 403', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'x', email: 'rando@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/errors-list/route');
    const res = await POST(mkReq({ accessToken: 'good' }));
    expect(res.status).toBe(403);
  });

  it('returns rows=[] when supabase responds empty', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/errors')) {
        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-range': '*/0' } })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/errors-list/route');
    const res = await POST(mkReq({ accessToken: 'good' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('passes filters (type, search, since_hours, limit) into the supabase query', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/errors')) {
        capturedUrl = url;
        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-range': '*/0' } })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/errors-list/route');
    const res = await POST(
      mkReq({
        accessToken: 'good',
        type: 'csp',
        search: 'TypeError',
        since_hours: 72,
        limit: 25,
      })
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('type=eq.csp');
    expect(capturedUrl).toContain('msg=ilike.');
    expect(capturedUrl).toContain('TypeError');
    expect(capturedUrl).toContain('limit=25');
  });
  // 2026-09-06: investigar "o erro do fabio" era impossível — o `search` só
  // casa em `msg`, e o id do usuário nunca aparece na mensagem.
  it('filtra por PESSOA quando vem user_id', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/errors')) {
        capturedUrl = url;
        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-range': '*/0' } })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/errors-list/route');
    const uid = '11111111-2222-3333-4444-555555555555';
    const res = await POST(mkReq({ accessToken: 'good', user_id: uid, type: 'publish-fail' }));
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain(`user_id=eq.${uid}`);
    expect(capturedUrl).toContain('type=eq.publish-fail');
  });

  it('user_id que não é UUID é ignorado (senão o PostgREST devolve 400)', async () => {
    // A coluna é `uuid`. Texto solto viraria 400, que a tela mostra como
    // "falha ao consultar logs" — erro nosso disfarçado de erro do banco.
    let capturedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/errors')) {
        capturedUrl = url;
        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-range': '*/0' } })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/errors-list/route');
    const res = await POST(mkReq({ accessToken: 'good', user_id: 'fabio' }));
    expect(res.status).toBe(200);
    expect(capturedUrl).not.toContain('user_id=');
  });
});
