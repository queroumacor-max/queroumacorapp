// __tests__/api/ig-art.test.ts — testes do route `/api/ig-art`.
// Endpoint mais complexo — só testa as portas (validações, auth, gating)
// porque mockar o pipeline OpenAI image-edit + Gemini fallback inteiro fica
// pesado e pouco útil. Service-level details ficam no service test (não
// presente — confiamos no port literal do vanilla).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installAuthMocks, mkJsonReq, type InstalledMocks } from './_helpers';

let mocks: InstalledMocks | null = null;

// Data URL "válida" só pra passar do regex (não precisa ser imagem real).
const TINY_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

describe('POST /api/ig-art', () => {
  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/ig-art/route');
    const res = await POST(
      mkJsonReq('/api/ig-art', { photoDataUrl: TINY_DATA_URL }) as never
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when photoDataUrl missing/invalid', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/ig-art/route');
    const res = await POST(
      mkJsonReq('/api/ig-art', { photoDataUrl: 'not-a-data-url' }) as never
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/ig-art/route');
    const res = await POST(
      mkJsonReq('/api/ig-art', { photoDataUrl: TINY_DATA_URL }) as never
    );
    // ServiceError 503 do service quando key falta.
    expect(res.status).toBe(503);
  });

  it('returns 502 when OpenAI image-edit fails and no Gemini key', async () => {
    mocks = installAuthMocks({
      fetchRest: async (url) => {
        if (url.includes('/style-refs/')) return new Response('', { status: 404 });
        if (url.includes('api.openai.com')) {
          return new Response('upstream-fail', { status: 500 });
        }
        // gemini caption também falha (sem key)
        return new Response('not mocked', { status: 500 });
      },
    });
    const { POST } = await import('@/app/api/ig-art/route');
    const res = await POST(
      mkJsonReq('/api/ig-art', { photoDataUrl: TINY_DATA_URL }) as never
    );
    // Falha = 502.
    expect([502, 504]).toContain(res.status);
  });

  it('returns 400 on invalid JSON body', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/ig-art/route');
    const req = new Request('https://app.test/api/ig-art', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer t',
      },
      body: 'not-json',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
