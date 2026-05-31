// __tests__/api/caption.test.ts — testes do route `/api/caption` (multipart).

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

function makeImageBlob(size = 1024): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

describe('POST /api/caption', () => {
  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/caption/route');
    const res = await POST(
      mkFormReq('/api/caption', { image: makeImageBlob() }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/caption/route');
    const res = await POST(
      mkFormReq('/api/caption', { image: makeImageBlob() }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns caption + hashtags', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    caption: 'Pintura linda',
                    hashtags: ['#pintura', '#arte'],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        ),
    });
    const { POST } = await import('@/app/api/caption/route');
    const res = await POST(
      mkFormReq('/api/caption', { image: makeImageBlob() }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.caption).toBe('Pintura linda');
    expect(body.hashtags).toContain('#pintura');
  });

  it('returns 400 when image missing', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/caption/route');
    const res = await POST(mkFormReq('/api/caption', {}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 502 when OpenAI errors out', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => new Response('upstream-fail', { status: 500 }),
    });
    const { POST } = await import('@/app/api/caption/route');
    const res = await POST(
      mkFormReq('/api/caption', { image: makeImageBlob() }) as never
    );
    expect(res.status).toBe(502);
  });
});
