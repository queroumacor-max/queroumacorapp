// __tests__/api/upload-style-ref.test.ts — testes do route handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkJsonReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/upload-style-ref', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function mkMultipartReq(formData: FormData, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://app.test/api/upload-style-ref', {
    method: 'POST',
    body: formData,
    headers,
  }) as unknown as NextRequest;
}

// 1x1 PNG (smallest valid)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.ADMIN_EMAILS = 'boss@x.com';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/upload-style-ref', () => {
  it('non-admin returns 403', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'x', email: 'rando@x.com' }), { status: 200 })
        );
      }
      return Promise.resolve(new Response('', { status: 200 }));
    });
    const { POST } = await import('@/app/api/upload-style-ref/route');
    const res = await POST(
      mkJsonReq({
        accessToken: 'good',
        styleKey: 'profissional',
        photoDataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
      })
    );
    expect(res.status).toBe(403);
  });

  it('admin happy path (JSON dataURL) uploads + returns public URL', async () => {
    let uploadCalled = false;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/storage/v1/object/style-refs/') && init?.method === 'POST') {
        uploadCalled = true;
        return Promise.resolve(new Response('', { status: 200 }));
      }
      // DELETE de outras extensões
      return Promise.resolve(new Response('', { status: 200 }));
    });
    const { POST } = await import('@/app/api/upload-style-ref/route');
    const res = await POST(
      mkJsonReq({
        accessToken: 'good',
        styleKey: 'profissional',
        photoDataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.styleKey).toBe('profissional');
    expect(body.url).toContain('/storage/v1/object/public/style-refs/profissional.png');
    expect(uploadCalled).toBe(true);
  });

  it('rejects unknown styleKey with 400', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com' }), { status: 200 })
        );
      }
      return Promise.resolve(new Response('', { status: 200 }));
    });
    const { POST } = await import('@/app/api/upload-style-ref/route');
    const res = await POST(
      mkJsonReq({
        accessToken: 'good',
        styleKey: 'malicious',
        photoDataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects oversized file (multipart) with 413', async () => {
    // Build a file just over 4MB
    const big = new Uint8Array(4 * 1024 * 1024 + 10);
    const file = new File([big], 'big.png', { type: 'image/png' });
    const form = new FormData();
    form.set('accessToken', 'good');
    form.set('styleKey', 'profissional');
    form.set('file', file);

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com' }), { status: 200 })
        );
      }
      return Promise.resolve(new Response('', { status: 200 }));
    });
    const { POST } = await import('@/app/api/upload-style-ref/route');
    const res = await POST(mkMultipartReq(form));
    expect(res.status).toBe(413);
  });
});
