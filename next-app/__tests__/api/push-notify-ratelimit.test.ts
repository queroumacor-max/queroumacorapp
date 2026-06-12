// __tests__/api/push-notify-ratelimit.test.ts — cobertura R-H1 + R-H10
// no `/api/push-notify`. Foca os gates novos (rate limit + Zod) sem
// duplicar o teste da criptografia Web Push (que vive no e2e).
//
// Mocka VAPID + Supabase pra evitar chamar `crypto.subtle` real — auth
// roda primeiro, Zod logo em seguida, rate limit no meio. Quando Zod
// rejeita (ou rate limit barra), o handler retorna antes de tocar
// VAPID/Supabase.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

const VALID_UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const VALID_UID_2 = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';

function mkReq(
  body: unknown,
  opts: { secret?: string; headers?: Record<string, string> } = {},
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-internal-secret': opts.secret ?? 'test-secret',
    ...(opts.headers || {}),
  };
  return new Request('https://app.test/api/push-notify', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

interface FetchMockOpts {
  /** RL response. Default = allowed. */
  rlAllowed?: boolean;
  rlRetryAfter?: number;
}

function installFetchMock(opts: FetchMockOpts = {}) {
  const { rlAllowed = true, rlRetryAfter = 60 } = opts;
  const fetchMock = vi.fn(
    async (url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/rest/v1/rpc/check_rate_limit')) {
        return new Response(
          JSON.stringify({
            allowed: rlAllowed,
            count: rlAllowed ? 1 : 61,
            limit: 60,
            retry_after_seconds: rlRetryAfter,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.includes('/rest/v1/push_subscriptions')) {
        // Sem subscriptions cadastradas → handler ainda retorna ok.
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: 200 });
    },
  );
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    PUSH_INTERNAL_SECRET: 'test-secret',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc-test',
    // VAPID keys: precisamos de algo válido pra passar do gate de config,
    // mas Zod + RL barram antes da criptografia. Mesmo nos testes "200"
    // o subscriptions list é vazio, então sendWebPush nunca corre.
    VAPID_PRIVATE_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'BPublicKeyDummy',
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/push-notify — auth + Zod + rate limit', () => {
  it('returns 401 when x-internal-secret is wrong', async () => {
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(
      mkReq(
        { userIds: [VALID_UID], title: 'Oi' },
        { secret: 'wrong' },
      ),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 503 when PUSH_INTERNAL_SECRET env is missing', async () => {
    delete process.env.PUSH_INTERNAL_SECRET;
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(mkReq({ userIds: [VALID_UID], title: 'Oi' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('push_disabled');
  });

  // ─── R-H10: Zod validation ─────────────────────────────────────────────

  it('returns 400 with invalid_input when userIds is missing', async () => {
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(mkReq({ title: 'Oi' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 400 with invalid_input when a userId is not a UUID', async () => {
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(
      mkReq({ userIds: ['not-uuid'], title: 'Oi' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('returns 400 when title is missing or empty', async () => {
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(mkReq({ userIds: [VALID_UID], title: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('returns 400 when userIds array exceeds max (100)', async () => {
    installFetchMock();
    const huge = new Array(101).fill(VALID_UID);
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(mkReq({ userIds: huge, title: 'Spam' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('returns 400 when url does not start with /', async () => {
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(
      mkReq({
        userIds: [VALID_UID],
        title: 'Oi',
        url: 'https://evil.com/redirect', // url precisa começar com '/'
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('returns 400 on malformed JSON body', async () => {
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const req = new Request('https://app.test/api/push-notify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': 'test-secret',
      },
      body: 'not-json{',
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_body');
  });

  // ─── R-H1: rate limit por IP ───────────────────────────────────────────

  it('returns 429 when rate limit is exhausted for the IP', async () => {
    installFetchMock({ rlAllowed: false, rlRetryAfter: 30 });
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(
      mkReq(
        { userIds: [VALID_UID], title: 'Oi' },
        { headers: { 'cf-connecting-ip': '203.0.113.42' } },
      ),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('keys rate limit by cf-connecting-ip header', async () => {
    const fetchMock = installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    await POST(
      mkReq(
        { userIds: [VALID_UID], title: 'Oi' },
        { headers: { 'cf-connecting-ip': '198.51.100.99' } },
      ),
    );
    const rlCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/rest/v1/rpc/check_rate_limit'),
    );
    expect(rlCall).toBeDefined();
    const rlInit = rlCall![1] as RequestInit;
    const rlBody = JSON.parse(rlInit.body as string);
    expect(rlBody.p_user_id).toBe('push-notify:198.51.100.99');
    expect(rlBody.p_endpoint).toBe('push-notify');
    expect(rlBody.p_limit).toBe(60);
  });

  // ─── happy path ────────────────────────────────────────────────────────

  it('returns 200 on valid body + RL ok (no subscriptions enqueued)', async () => {
    installFetchMock();
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(
      mkReq({ userIds: [VALID_UID, VALID_UID_2], title: 'Oi', body: 'msg' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(0);
  });

  it('logs warning when userIds > 50 (high-volume signal)', async () => {
    installFetchMock();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = new Array(60).fill(0).map((_, i) => {
      // gera UUIDs válidos diferentes
      const hex = i.toString(16).padStart(12, '0');
      return `aaaaaaaa-bbbb-cccc-dddd-${hex}`;
    });
    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(
      mkReq(
        { userIds: many, title: 'big blast' },
        { headers: { 'cf-connecting-ip': '203.0.113.1' } },
      ),
    );
    expect(res.status).toBe(200);
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('high-volume call'))).toBe(true);
    warnSpy.mockRestore();
  });
});
