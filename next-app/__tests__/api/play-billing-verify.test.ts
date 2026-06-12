// __tests__/api/play-billing-verify.test.ts — testes do route handler
// `/api/play-billing-verify`. Cobre CRIT-1 (kill-switch via env var):
// sem `IAP_PRODUCTION_VERIFICATION_ENABLED='true'` o endpoint retorna 503
// `iap_not_implemented` e NÃO chama `upsert_invoice`. Quando a flag está
// ligada, o stub legacy segue (ainda chama upsert_invoice).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://app.test/api/play-billing-verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function authOkResponse(): Response {
  return new Response(
    JSON.stringify({ id: 'user-uuid-1', email: 'a@b.com' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function upsertOkResponse(): Response {
  return new Response('', { status: 200 });
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
  delete process.env.IAP_PRODUCTION_VERIFICATION_ENABLED;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/play-billing-verify', () => {
  it('returns 503 iap_not_implemented when IAP_PRODUCTION_VERIFICATION_ENABLED is unset', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/v1/user')) return authOkResponse();
      // audit_log insert é fail-open; permitimos retornar 200 sem efeito.
      if (url.includes('/rest/v1/audit_log')) return new Response('', { status: 200 });
      // upsert_invoice NÃO deve ser chamado.
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { POST } = await import('@/app/api/play-billing-verify/route');
    const res = await POST(
      mkReq({ purchaseToken: 'fake-token-abc', productId: 'pro_monthly' })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('iap_not_implemented');
    expect(body.message).toMatch(/Google Play Billing/i);

    // Garante que upsert_invoice não foi chamado.
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('rpc/upsert_invoice'))).toBe(false);
  });

  it('returns 503 iap_not_implemented when IAP_PRODUCTION_VERIFICATION_ENABLED !== "true"', async () => {
    process.env.IAP_PRODUCTION_VERIFICATION_ENABLED = '1'; // truthy mas não exatamente "true"
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/v1/user')) return authOkResponse();
      if (url.includes('/rest/v1/audit_log')) return new Response('', { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { POST } = await import('@/app/api/play-billing-verify/route');
    const res = await POST(
      mkReq({ purchaseToken: 'fake-token-xyz', productId: 'pro_monthly' })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('iap_not_implemented');

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('rpc/upsert_invoice'))).toBe(false);
  });

  it('proceeds to upsert_invoice when IAP_PRODUCTION_VERIFICATION_ENABLED === "true" (stub still active)', async () => {
    process.env.IAP_PRODUCTION_VERIFICATION_ENABLED = 'true';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/v1/user')) return authOkResponse();
      if (url.includes('/rest/v1/rpc/upsert_invoice')) return upsertOkResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { POST } = await import('@/app/api/play-billing-verify/route');
    const res = await POST(
      mkReq({ purchaseToken: 'token-genuino', productId: 'pro_monthly' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.plan).toBe('pro');

    // upsert_invoice precisa ter sido chamado.
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('rpc/upsert_invoice'))).toBe(true);
  });

  it('returns 401 when auth fails (gate is irrelevant)', async () => {
    // Sem accessToken; sem header bearer válido — requireAuthStrict rejeita.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/v1/user')) return new Response('', { status: 401 });
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { POST } = await import('@/app/api/play-billing-verify/route');
    const req = new Request('https://app.test/api/play-billing-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer bad-jwt',
      },
      body: JSON.stringify({ purchaseToken: 't', productId: 'p' }),
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when purchaseToken missing', async () => {
    const { POST } = await import('@/app/api/play-billing-verify/route');
    const res = await POST(mkReq({ productId: 'pro_monthly' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/purchaseToken/);
  });
});
