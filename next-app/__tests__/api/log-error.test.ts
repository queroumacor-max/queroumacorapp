// __tests__/api/log-error.test.ts — testes do route handler `/api/log-error`.
// Exercita: payload válido + sanitização, body inválido (200 silencioso),
// fail-open sem service-role key, propagação de campos pro Supabase, e os
// novos gates R-H2 (rate limit por IP) + R-H10 (Zod validation).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new Request('https://app.test/api/log-error', {
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

describe('POST /api/log-error', () => {
  it('returns 200 ok for valid payload (fail-open without service key)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(mkReq({ msg: 'boom', type: 'js' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 200 ok silently on malformed JSON body', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(mkReq('not-json{'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('inserts into Supabase errors table when service key present', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const u = typeof url === 'string' ? url : url.toString();
        // checkRateLimit RPC call → allowed
        if (u.includes('/rest/v1/rpc/check_rate_limit')) {
          return new Response(JSON.stringify({ allowed: true, count: 1, limit: 30 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('', { status: 201 });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(
      mkReq({
        msg: 'oops',
        stack: 'Error: oops\n  at foo',
        type: 'js',
        url: 'https://queroumacor.com.br/x',
        ua: 'Mozilla/5.0',
        user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      })
    );
    expect(res.status).toBe(200);
    const insertCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/rest/v1/errors'),
    );
    expect(insertCall).toBeDefined();
    const init = insertCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent.msg).toBe('oops');
    expect(sent.user_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect((init.headers as Record<string, string>).apikey).toBe('svc-test');
  });

  it('sanitizePayload strips invalid user_id and truncates long fields', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { sanitizeErrorPayload } = await import('@/lib/api/log-error-helpers');
    const safe = sanitizeErrorPayload({
      msg: 'x'.repeat(1000),
      user_id: 'not-a-uuid',
      type: 'js',
    });
    // sanitizer truncates msg ao limite dele (500); o Zod schema permite 1000.
    expect(safe.msg?.length).toBe(500);
    expect(safe.user_id).toBeNull();
    expect(safe.type).toBe('js');
  });

  it('OPTIONS returns 204', async () => {
    const { OPTIONS } = await import('@/app/api/log-error/route');
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });

  // ─── R-H10: Zod validation ─────────────────────────────────────────────

  it('returns 200 silently when body has invalid shape (Zod fail)', async () => {
    // msg too long → Zod barra. Endpoint mantém fail-soft (200 + log warning)
    // pra evitar loop log-error → log-error em clientes com payload bugado.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(mkReq({ msg: 'x'.repeat(2000) })); // > 1000 chars
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns 200 silently when user_id is not a UUID (Zod fail)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(mkReq({ msg: 'oops', user_id: 'not-a-uuid' }));
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ─── R-H2: rate limit por IP ───────────────────────────────────────────

  it('returns 429 when rate limit exceeded for the IP', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/rest/v1/rpc/check_rate_limit')) {
          return new Response(
            JSON.stringify({
              allowed: false,
              count: 31,
              limit: 30,
              retry_after_seconds: 45,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('', { status: 500 });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(
      mkReq({ msg: 'spam' }, { 'cf-connecting-ip': '203.0.113.7' }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('45');
    // Não deve ter inserido em /errors.
    const insertCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/rest/v1/errors'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('uses cf-connecting-ip header when present for rate limit key', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/rest/v1/rpc/check_rate_limit')) {
          return new Response(JSON.stringify({ allowed: true, count: 1, limit: 30 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('', { status: 201 });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const { POST } = await import('@/app/api/log-error/route');
    await POST(mkReq({ msg: 'ok' }, { 'cf-connecting-ip': '198.51.100.1' }));
    const rlCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/rest/v1/rpc/check_rate_limit'),
    );
    expect(rlCall).toBeDefined();
    const rlInit = rlCall![1] as RequestInit;
    const rlBody = JSON.parse(rlInit.body as string);
    expect(rlBody.p_user_id).toBe('log-error:198.51.100.1');
    expect(rlBody.p_endpoint).toBe('log-error');
    expect(rlBody.p_limit).toBe(30);
  });
});
