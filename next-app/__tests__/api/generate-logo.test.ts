// __tests__/api/generate-logo.test.ts — testes do route `/api/generate-logo`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installAuthMocks, mkJsonReq, type InstalledMocks } from './_helpers';

let mocks: InstalledMocks | null = null;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

describe('POST /api/generate-logo', () => {
  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali' }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali' }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns 3 logo urls', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({ data: [{ b64_json: 'AAA==' }] }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', {
        name: 'Cali Colors',
        style: 'modern',
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.urls).toHaveLength(3);
    expect(body.urls[0]).toContain('data:image/png;base64,');
  });

  it('returns 400 when name missing', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(mkJsonReq('/api/generate-logo', {}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 500 when DALL-E returns no image', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(JSON.stringify({ data: [{}] }), { status: 200 }),
    });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali' }) as never
    );
    // ServiceError 502 esperado quando Promise.all não devolve imagem.
    expect([500, 502]).toContain(res.status);
  });
});
