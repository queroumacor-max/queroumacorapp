// __tests__/api/moderate.test.ts — testes do route `/api/moderate`.
// moderate NÃO é PRO-only — só requer auth.

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

describe('POST /api/moderate', () => {
  it('returns 503 when GEMINI_API_KEY missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const { POST } = await import('@/app/api/moderate/route');
    const res = await POST(
      mkJsonReq('/api/moderate', { text: 'oi' }) as never
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.engine).toBe('none');
  });

  it('returns 401 when no auth token', async () => {
    mocks = installAuthMocks({ unauth: true });
    const { POST } = await import('@/app/api/moderate/route');
    const req = new Request('https://app.test/api/moderate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('happy path: returns moderation verdict', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        geminiTextResponse(
          JSON.stringify({ flagged: false, severity: 'none', reasons: [] })
        ),
    });
    const { POST } = await import('@/app/api/moderate/route');
    const res = await POST(
      mkJsonReq('/api/moderate', { text: 'pintura linda' }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flagged).toBe(false);
    expect(body.severity).toBe('none');
    expect(body.engine).toBe('gemini');
  });

  it('returns engine=none for empty input (no Gemini call)', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/moderate/route');
    const res = await POST(mkJsonReq('/api/moderate', {}) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engine).toBe('none');
  });

  it('detects scam lures even when Gemini says none', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        geminiTextResponse(
          JSON.stringify({ flagged: false, severity: 'none', reasons: [] })
        ),
    });
    const { POST } = await import('@/app/api/moderate/route');
    const res = await POST(
      mkJsonReq('/api/moderate', {
        text: 'pix antecipado pra liberar',
      }) as never
    );
    const body = await res.json();
    expect(body.flagged).toBe(true);
    expect(body.reasons).toContain('golpe');
  });
});
