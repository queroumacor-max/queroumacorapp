// __tests__/api/mp-checkout-loja.test.ts — testes do route handler
// `/api/mp-checkout-loja`. Cobre: happy, orderId vazio, auth fail,
// order de outro user, pedido já processado, MP down, item inválido.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/mp-checkout-loja', {
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
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
  process.env.MP_ACCESS_TOKEN = 'mp-secret';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/mp-checkout-loja', () => {
  it('returns 503 when MP_ACCESS_TOKEN missing', async () => {
    delete process.env.MP_ACCESS_TOKEN;
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1', accessToken: 'jwt' }));
    expect(res.status).toBe(503);
  });

  it('returns 400 when orderId missing', async () => {
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ accessToken: 'jwt' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/orderId/);
  });

  it('returns 401 when accessToken missing', async () => {
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when Supabase rejects token', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1', accessToken: 'bad' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when order does not belong to user', async () => {
    globalThis.fetch = vi
      .fn()
      // /auth/v1/user
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'user-A', email: 'a@b.com' }), {
          status: 200,
        })
      )
      // order belongs to user-B
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'ord-1', user_id: 'user-B', total: 100, status: 'pending', items: [] },
          ]),
          { status: 200 }
        )
      );
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1', accessToken: 'jwt' }));
    expect(res.status).toBe(403);
  });

  it('returns 409 when order already processed', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'user-A', email: 'a@b.com' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'ord-1', user_id: 'user-A', total: 100, status: 'paid', items: [] },
          ]),
          { status: 200 }
        )
      );
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1', accessToken: 'jwt' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/processado|paid/);
  });

  it('returns 400 when product is inactive', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'user-A', email: 'a@b.com' }), {
          status: 200,
        })
      )
      // order found
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'ord-1',
              user_id: 'user-A',
              total: 100,
              status: 'pending',
              items: [{ id: 'prod-1', qty: 1 }],
            },
          ]),
          { status: 200 }
        )
      )
      // products: inactive
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'prod-1', name: 'X', price: 100, active: false },
          ]),
          { status: 200 }
        )
      );
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1', accessToken: 'jwt' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/inativo/i);
  });

  it('happy path: creates preference and returns init_point', async () => {
    const fetchMock = vi
      .fn()
      // auth
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'user-A', email: 'a@b.com' }), {
          status: 200,
        })
      )
      // order
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'ord-1',
              user_id: 'user-A',
              total: 150,
              status: 'pending',
              items: [{ id: 'prod-1', qty: 2 }],
            },
          ]),
          { status: 200 }
        )
      )
      // products
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'prod-1', name: 'Tinta', price: 75, active: true },
          ]),
          { status: 200 }
        )
      )
      // MP preferences
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            init_point: 'https://mp/checkout/pref-xyz',
            id: 'pref-xyz',
          }),
          { status: 201 }
        )
      )
      // PATCH order gateway+payment_url
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1', accessToken: 'jwt' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.init_point).toBe('https://mp/checkout/pref-xyz');
    expect(body.orderId).toBe('ord-1');
    expect(body.preference_id).toBe('pref-xyz');

    // Verifica payload MP: re-monta items com preço autoritativo
    const mpCall = fetchMock.mock.calls[3];
    expect(mpCall[0]).toBe('https://api.mercadopago.com/checkout/preferences');
    const sent = JSON.parse(mpCall[1].body);
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0].unit_price).toBe(75);
    expect(sent.items[0].quantity).toBe(2);
    expect(sent.external_reference).toBe('ord-1');
  });

  it('returns 502 when MP API errors', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'user-A', email: 'a@b.com' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'ord-1',
              user_id: 'user-A',
              total: 100,
              status: 'pending',
              items: [{ id: 'prod-1', qty: 1 }],
            },
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 'prod-1', name: 'X', price: 100, active: true }]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'oops' }), { status: 500 })
      );
    const { POST } = await import('@/app/api/mp-checkout-loja/route');
    const res = await POST(mkReq({ orderId: 'ord-1', accessToken: 'jwt' }));
    expect(res.status).toBe(502);
  });
});
