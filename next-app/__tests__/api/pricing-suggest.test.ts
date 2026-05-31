// __tests__/api/pricing-suggest.test.ts — testes do route `/api/pricing-suggest`.

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

describe('POST /api/pricing-suggest', () => {
  it('returns 502 when OPENAI_API_KEY missing (vanilla parity)', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/pricing-suggest/route');
    const res = await POST(
      mkJsonReq('/api/pricing-suggest', { service_type: 'pintura' }) as never
    );
    // pricing-suggest usa 502 (vanilla quirk) em vez de 503.
    expect(res.status).toBe(502);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/pricing-suggest/route');
    const res = await POST(
      mkJsonReq('/api/pricing-suggest', { service_type: 'pintura' }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns price + justification', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    area_m2: 50,
                    rate_brl_per_m2: 30,
                    extras_brl: 0,
                    price: 1500,
                    justification: '50 m² × R$ 30/m² para pintura interna.',
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/pricing-suggest/route');
    const res = await POST(
      mkJsonReq('/api/pricing-suggest', {
        service_type: 'Pintura interna',
        area_m2: 50,
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.price).toBe(1500);
  });

  it('returns 400 when all inputs empty', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/pricing-suggest/route');
    const res = await POST(mkJsonReq('/api/pricing-suggest', {}) as never);
    expect(res.status).toBe(400);
  });

  it('corrects price when IA math is off', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    area_m2: 75,
                    rate_brl_per_m2: 25,
                    extras_brl: 0,
                    price: 375, // ERRO: deveria ser 1875.
                    justification: 'bug',
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/pricing-suggest/route');
    const res = await POST(
      mkJsonReq('/api/pricing-suggest', {
        service_type: 'Pintura',
        area_m2: 75,
      }) as never
    );
    const body = await res.json();
    expect(body.price).toBe(1875); // recalculado determinísticamente.
  });
});
