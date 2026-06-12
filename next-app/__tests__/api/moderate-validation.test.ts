// __tests__/api/moderate-validation.test.ts — R-H10 (validação Zod).
// Cobre rejeição de body inválido em `/api/moderate` antes do auth.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installAuthMocks,
  mkJsonReq,
  geminiTextResponse,
  type InstalledMocks,
} from './_helpers';

let mocks: InstalledMocks | null = null;

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'gemini-test';
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

describe('POST /api/moderate — Zod validation (R-H10)', () => {
  it('rejects text with wrong type (number) → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/moderate/route');
    const res = await POST(mkJsonReq('/api/moderate', { text: 12345 }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects text too long (> 10_000 chars) → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/moderate/route');
    const huge = 'x'.repeat(10_001);
    const res = await POST(mkJsonReq('/api/moderate', { text: huge }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects mediaUrl that is not a URL → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/moderate/route');
    const res = await POST(
      mkJsonReq('/api/moderate', { mediaUrl: 'not-a-url' }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects malformed JSON body → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/moderate/route');
    const req = new Request('https://app.test/api/moderate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: 'not-json{',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JSON/);
  });

  it('accepts valid body with text → flows to handler (200)', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        geminiTextResponse(
          JSON.stringify({ flagged: false, severity: 'none', reasons: [] })
        ),
    });
    const { POST } = await import('@/app/api/moderate/route');
    const res = await POST(
      mkJsonReq('/api/moderate', { text: 'tinta verde sálvia' }) as never
    );
    expect(res.status).toBe(200);
  });
});
