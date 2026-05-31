// __tests__/api/ig-art-diag.test.ts — testes do route `/api/ig-art-diag`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installAuthMocks, type InstalledMocks } from './_helpers';

let mocks: InstalledMocks | null = null;

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

function mkGetReq(url: string): Request {
  return new Request(url, {
    method: 'GET',
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/ig-art-diag', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'g-test';
  });

  it('returns 503 when service key missing (gateProAI fail-closed)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    const { GET } = await import('@/app/api/ig-art-diag/route');
    const res = await GET(mkGetReq('https://app.test/api/ig-art-diag') as never);
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { GET } = await import('@/app/api/ig-art-diag/route');
    const res = await GET(mkGetReq('https://app.test/api/ig-art-diag') as never);
    expect(res.status).toBe(403);
  });

  it('happy path: lists Gemini models', async () => {
    mocks = installAuthMocks({
      fetchRest: async (url) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response(
            JSON.stringify({
              models: [
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response('not mocked', { status: 500 });
      },
    });
    const { GET } = await import('@/app/api/ig-art-diag/route');
    const res = await GET(mkGetReq('https://app.test/api/ig-art-diag') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gemini.configured).toBe(true);
    expect(body.gemini.total).toBe(2);
    expect(body.gemini.image_models).toHaveLength(1);
  });

  it('reports gemini error when API fails', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => new Response('boom', { status: 500 }),
    });
    const { GET } = await import('@/app/api/ig-art-diag/route');
    const res = await GET(mkGetReq('https://app.test/api/ig-art-diag') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gemini.error).toMatch(/HTTP 500/);
  });

  it('also tests OpenAI when ?openai=1', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    mocks = installAuthMocks({
      fetchRest: async (url) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response(JSON.stringify({ models: [] }), { status: 200 });
        }
        if (url.includes('api.openai.com/v1/models')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'gpt-image-1' }, { id: 'gpt-4o' }] }),
            { status: 200 }
          );
        }
        return new Response('not mocked', { status: 500 });
      },
    });
    const { GET } = await import('@/app/api/ig-art-diag/route');
    const res = await GET(
      mkGetReq('https://app.test/api/ig-art-diag?openai=1') as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openai.image_models).toContain('gpt-image-1');
  });
});
