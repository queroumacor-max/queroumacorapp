// __tests__/api/checkout-validation.test.ts — R-H10 (validação Zod).
// Cobre rejeição de body inválido em `/api/checkout` antes do auth/MP.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.MP_ACCESS_TOKEN = 'mp-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('POST /api/checkout — Zod validation (R-H10)', () => {
  it('rejects accessToken with wrong type (number) → 400', async () => {
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({ accessToken: 12345 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects empty-string accessToken (min 1 char) → 400', async () => {
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({ accessToken: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects accessToken > 2000 chars (DoS protection) → 400', async () => {
    const { POST } = await import('@/app/api/checkout/route');
    const huge = 'x'.repeat(2500);
    const res = await POST(mkReq({ accessToken: huge }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects productId with wrong type → 400', async () => {
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({ productId: { id: 'abc' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('accepts valid body (empty {} → passes to handler, then 401 by auth)', async () => {
    // Body {} é válido (accessToken e productId são opcionais).
    // O handler então segue pra requireAuthStrict que devolve 401 sem token.
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(mkReq({}));
    // Não é 400 (passou na validação Zod) — é 401 (faltou auth).
    expect(res.status).toBe(401);
  });
});
