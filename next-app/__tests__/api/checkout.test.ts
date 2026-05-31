// __tests__/api/checkout.test.ts — testes do route handler `/api/checkout`.
// Cobre: happy path (cria preapproval), MP_ACCESS_TOKEN ausente → 503,
// accessToken ausente → 401, token inválido no Supabase → 401,
// MP API down → 502.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

describe('POST /api/checkout', () => {
  it('returns 503 when MP_ACCESS_TOKEN missing', async () => {
    delete process.env.MP_ACCESS_TOKEN;
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({ accessToken: 'jwt-stub' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/MP_ACCESS_TOKEN/);
  });

  it('returns 401 when accessToken missing', async () => {
    process.env.MP_ACCESS_TOKEN = 'mp-secret';
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/login|accessToken/i);
  });

  it('returns 401 when Supabase rejects token', async () => {
    process.env.MP_ACCESS_TOKEN = 'mp-secret';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({ accessToken: 'bad-jwt' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Sessão|login/i);
  });

  it('returns init_point on happy path', async () => {
    process.env.MP_ACCESS_TOKEN = 'mp-secret';
    globalThis.fetch = vi
      .fn()
      // 1) /auth/v1/user
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'user-uuid-1', email: 'a@b.com' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      // 2) MP preapproval
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            init_point: 'https://mp/checkout/pref-abc',
            id: 'pref-abc',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      );
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({ accessToken: 'good-jwt' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.init_point).toBe('https://mp/checkout/pref-abc');
    expect(body.preapproval_id).toBe('pref-abc');

    // Verifica que o body enviado pro MP tem external_reference=userId
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const mpCall = fetchMock.mock.calls[1];
    expect(mpCall[0]).toBe('https://api.mercadopago.com/preapproval');
    const sent = JSON.parse(mpCall[1].body);
    expect(sent.external_reference).toBe('user-uuid-1');
    expect(sent.payer_email).toBe('a@b.com');
    expect(sent.auto_recurring.transaction_amount).toBe(39);
    expect(sent.auto_recurring.currency_id).toBe('BRL');
  });

  it('returns 502 when MP API returns error', async () => {
    process.env.MP_ACCESS_TOKEN = 'mp-secret';
    globalThis.fetch = vi
      .fn()
      // auth ok
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'user-uuid-1', email: 'a@b.com' }),
          { status: 200 }
        )
      )
      // MP 500
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'oops' }), { status: 500 })
      );
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({ accessToken: 'good-jwt' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Falha temporária|pagamento/i);
  });

  it('returns 400 when JSON body invalid', async () => {
    process.env.MP_ACCESS_TOKEN = 'mp-secret';
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq('not-json{'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JSON/);
  });
});
