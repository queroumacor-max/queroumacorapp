// __tests__/api/tts.test.ts — testes do route `/api/tts`.
// Devolve audio/mpeg binário.

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

describe('POST /api/tts', () => {
  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/tts/route');
    const res = await POST(mkJsonReq('/api/tts', { text: 'oi' }) as never);
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/tts/route');
    const res = await POST(mkJsonReq('/api/tts', { text: 'oi' }) as never);
    expect(res.status).toBe(403);
  });

  it('happy path: returns audio/ogg opus bytes', async () => {
    // Route mudou pra ogg/opus (route.ts:41) — menor que mp3 em 4G, todos
    // browsers modernos suportam. Upstream OpenAI continua retornando mp3,
    // mas o frontend recebe via response opus.
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(new Uint8Array([0x1, 0x2, 0x3]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
    });
    const { POST } = await import('@/app/api/tts/route');
    const res = await POST(mkJsonReq('/api/tts', { text: 'oi' }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/ogg; codecs=opus');
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBe(3);
  });

  it('returns 400 when text empty', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/tts/route');
    const res = await POST(mkJsonReq('/api/tts', { text: '   ' }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 502 when OpenAI fails', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => new Response('boom', { status: 500 }),
    });
    const { POST } = await import('@/app/api/tts/route');
    const res = await POST(mkJsonReq('/api/tts', { text: 'oi' }) as never);
    expect(res.status).toBe(502);
  });
});
