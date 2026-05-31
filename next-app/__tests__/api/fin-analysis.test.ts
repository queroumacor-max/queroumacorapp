// __tests__/api/fin-analysis.test.ts — testes do route `/api/fin-analysis`.

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

describe('POST /api/fin-analysis', () => {
  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/fin-analysis/route');
    const res = await POST(
      mkJsonReq('/api/fin-analysis', { thisMonth: {} }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/fin-analysis/route');
    const res = await POST(
      mkJsonReq('/api/fin-analysis', { thisMonth: {} }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns analysis text', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    analysis: 'Margem de 40%, melhor que mês anterior.',
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/fin-analysis/route');
    const res = await POST(
      mkJsonReq('/api/fin-analysis', {
        thisMonth: { receita: 5000, custos: 3000, lucro: 2000, jobsCount: 3 },
        lastMonth: { receita: 4000, custos: 2500, lucro: 1500, jobsCount: 2 },
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toMatch(/Margem/);
  });

  it('returns 502 when OpenAI errors out', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => new Response('upstream-fail', { status: 500 }),
    });
    const { POST } = await import('@/app/api/fin-analysis/route');
    const res = await POST(
      mkJsonReq('/api/fin-analysis', { thisMonth: {} }) as never
    );
    expect(res.status).toBe(502);
  });

  it('returns 502 when IA returns empty analysis', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"analysis": ""}' } }],
          }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/fin-analysis/route');
    const res = await POST(
      mkJsonReq('/api/fin-analysis', { thisMonth: {} }) as never
    );
    expect(res.status).toBe(502);
  });
});
