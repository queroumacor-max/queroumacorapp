// __tests__/api/transcribe.test.ts — testes do route `/api/transcribe`.

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

function audioBlob(): Blob {
  return new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
}

describe('POST /api/transcribe', () => {
  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/transcribe/route');
    const res = await POST(
      mkFormReq('/api/transcribe', { audio: audioBlob() }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/transcribe/route');
    const res = await POST(
      mkFormReq('/api/transcribe', { audio: audioBlob() }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns transcribed text', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(JSON.stringify({ text: 'olá seu zé' }), { status: 200 }),
    });
    const { POST } = await import('@/app/api/transcribe/route');
    const res = await POST(
      mkFormReq('/api/transcribe', { audio: audioBlob() }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe('olá seu zé');
  });

  it('returns 400 when audio missing', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/transcribe/route');
    const res = await POST(mkFormReq('/api/transcribe', {}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 502 when Whisper fails', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => new Response('boom', { status: 500 }),
    });
    const { POST } = await import('@/app/api/transcribe/route');
    const res = await POST(
      mkFormReq('/api/transcribe', { audio: audioBlob() }) as never
    );
    expect(res.status).toBe(502);
  });
});
