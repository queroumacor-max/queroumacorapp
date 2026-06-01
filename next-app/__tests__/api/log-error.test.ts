// __tests__/api/log-error.test.ts — testes do route handler `/api/log-error`.
// Exercita: payload válido + sanitização, body inválido (200 silencioso),
// fail-open sem service-role key, e propagação de campos pro Supabase.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/log-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/log-error', () => {
  it('returns 200 ok for valid payload (fail-open without service key)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(mkReq({ msg: 'boom', type: 'js' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 200 ok silently on malformed JSON body', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(mkReq('not-json{'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('inserts into Supabase errors table when service key present', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 201 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(
      mkReq({
        msg: 'oops',
        stack: 'Error: oops\n  at foo',
        type: 'js',
        url: 'https://queroumacor.com.br/x',
        ua: 'Mozilla/5.0',
        user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      })
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://example.supabase.co/rest/v1/errors');
    expect(call[1].method).toBe('POST');
    const sent = JSON.parse(call[1].body);
    expect(sent.msg).toBe('oops');
    expect(sent.user_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(call[1].headers.apikey).toBe('svc-test');
  });

  it('sanitizePayload strips invalid user_id and truncates long fields', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { sanitizeErrorPayload } = await import('@/lib/api/log-error-helpers');
    const safe = sanitizeErrorPayload({
      msg: 'x'.repeat(1000),
      user_id: 'not-a-uuid',
      type: 'js',
    });
    expect(safe.msg?.length).toBe(500);
    expect(safe.user_id).toBeNull();
    expect(safe.type).toBe('js');
  });

  it('OPTIONS returns 204', async () => {
    const { OPTIONS } = await import('@/app/api/log-error/route');
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});
