// __tests__/api/moderate-video.test.ts — testes do route `/api/moderate-video`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installAuthMocks, mkJsonReq, type InstalledMocks } from './_helpers';

let mocks: InstalledMocks | null = null;

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'gemini-test';
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

describe('POST /api/moderate-video', () => {
  it('returns 503 when GEMINI_API_KEY missing', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    const { POST } = await import('@/app/api/moderate-video/route');
    const res = await POST(
      mkJsonReq('/api/moderate-video', { postId: 'abc' }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 503 when SUPABASE_SERVICE_ROLE_KEY missing', async () => {
    process.env.GEMINI_API_KEY = 'gemini';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    const { POST } = await import('@/app/api/moderate-video/route');
    const res = await POST(
      mkJsonReq('/api/moderate-video', { postId: 'abc' }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 400 when postId missing', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/moderate-video/route');
    const res = await POST(
      mkJsonReq('/api/moderate-video', { accessToken: 't' }) as never
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 when token invalid', async () => {
    mocks = installAuthMocks({ unauth: true });
    const { POST } = await import('@/app/api/moderate-video/route');
    const res = await POST(
      mkJsonReq('/api/moderate-video', {
        accessToken: 'bad',
        postId: 'p1',
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when user does not own the post', async () => {
    mocks = installAuthMocks({
      fetchRest: async (url) => {
        // post.user_id mismatch → 403
        if (url.includes('/rest/v1/posts')) {
          return new Response(
            JSON.stringify([
              { user_id: 'other-user', media_url: 'https://test.supabase.co/storage/v1/object/posts/x.mp4' },
            ]),
            { status: 200 }
          );
        }
        return new Response('not mocked', { status: 500 });
      },
    });
    const { POST } = await import('@/app/api/moderate-video/route');
    const res = await POST(
      mkJsonReq('/api/moderate-video', {
        accessToken: 't',
        postId: 'p1',
      }) as never
    );
    expect(res.status).toBe(403);
  });
});
