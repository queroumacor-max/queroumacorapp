// set-session-cookie.test.ts — o cookie do guard /admin/* só é gravado a
// pedido da PRÓPRIA aplicação (auditoria 2026-09-11: login CSRF via
// `<form enctype="text/plain">` fixava a sessão do atacante na vítima).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const SELF = 'https://www.queroumacor.com.br';

function req(method: 'POST' | 'DELETE', headers: Record<string, string>, body?: unknown): NextRequest {
  return new Request(`${SELF}/api/auth/set-session-cookie`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('/api/auth/set-session-cookie — mesma origem obrigatória', () => {
  it('POST cross-site (Origin de outro site) → 403 e NENHUM cookie', async () => {
    const { POST } = await import('@/app/api/auth/set-session-cookie/route');
    const res = await POST(req('POST', { origin: 'https://evil.example' }, { accessToken: 'a.b.c' }));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('POST com Sec-Fetch-Site: cross-site → 403', async () => {
    const { POST } = await import('@/app/api/auth/set-session-cookie/route');
    const res = await POST(
      req('POST', { origin: SELF, 'sec-fetch-site': 'cross-site' }, { accessToken: 'a.b.c' }),
    );
    expect(res.status).toBe(403);
  });

  it('DELETE cross-site → 403 (logout CSRF)', async () => {
    const { DELETE } = await import('@/app/api/auth/set-session-cookie/route');
    const res = await DELETE(req('DELETE', { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });

  it('POST da própria origem com token válido → grava cookie httpOnly', async () => {
    const { POST } = await import('@/app/api/auth/set-session-cookie/route');
    const res = await POST(
      req('POST', { origin: SELF, 'sec-fetch-site': 'same-origin' }, { accessToken: 'a.b.c' }),
    );
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie') || '';
    expect(sc).toContain('sb-session-token=a.b.c');
    expect(sc.toLowerCase()).toContain('httponly');
    expect(sc.toLowerCase()).toContain('secure');
    expect(sc.toLowerCase()).toContain('samesite=lax');
  });

  it('token recusado pelo GoTrue → 401 sem cookie', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const { POST } = await import('@/app/api/auth/set-session-cookie/route');
    const res = await POST(req('POST', { origin: SELF }, { accessToken: 'a.b.c' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
