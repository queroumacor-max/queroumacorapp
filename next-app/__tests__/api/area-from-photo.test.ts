// __tests__/api/area-from-photo.test.ts — testes do route `/api/area-from-photo`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installAuthMocks, mkFormReq, type InstalledMocks } from './_helpers';

let mocks: InstalledMocks | null = null;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

function imageBlob(): Blob {
  return new Blob([new Uint8Array(1024)], { type: 'image/jpeg' });
}

describe('POST /api/area-from-photo', () => {
  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/area-from-photo/route');
    const res = await POST(
      mkFormReq('/api/area-from-photo', { image: imageBlob() }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/area-from-photo/route');
    const res = await POST(
      mkFormReq('/api/area-from-photo', { image: imageBlob() }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns area_m2 + justification', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    area_m2: 25.4,
                    justification: 'Quarto pequeno.',
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/area-from-photo/route');
    const res = await POST(
      mkFormReq('/api/area-from-photo', { image: imageBlob() }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.area_m2).toBe(25.4);
    expect(body.justification).toMatch(/Quarto/);
  });

  it('returns 400 when image missing', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/area-from-photo/route');
    const res = await POST(mkFormReq('/api/area-from-photo', {}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 502 when IA returns invalid area', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"area_m2": "nan", "justification": "x"}' } }],
          }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/area-from-photo/route');
    const res = await POST(
      mkFormReq('/api/area-from-photo', { image: imageBlob() }) as never
    );
    expect(res.status).toBe(502);
  });
});
