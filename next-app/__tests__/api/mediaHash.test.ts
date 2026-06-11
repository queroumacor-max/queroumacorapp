// __tests__/api/mediaHash.test.ts — testes dos helpers de CSAM (Wave 29).
//
// Cobertura:
//   hashMedia:
//     - retorna SHA-256 hex de 64 chars determinístico
//     - mesmo input → mesmo hash (consistência)
//     - input vazio → string vazia
//   checkHashBlocklist:
//     - happy path: hit retorna { blocked: true, category, id }
//     - miss (lista vazia) → { blocked: false }
//     - sem service key → { blocked: false } (fail-open)
//     - erro de rede → { blocked: false }
//   enqueueMediaReview:
//     - POST correto (payload, headers, URL)
//     - sem userId → no-op silencioso
//     - sem service key → no-op

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  hashMedia,
  checkHashBlocklist,
  enqueueMediaReview,
} from '@/lib/api/mediaHash';

const SUPA_URL_TEST = 'https://test.supabase.co';

let originalFetch: typeof globalThis.fetch;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalEnv = { ...process.env };
  process.env.SUPABASE_URL = SUPA_URL_TEST;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// ── hashMedia ────────────────────────────────────────────────────────

describe('hashMedia', () => {
  it('retorna SHA-256 hex de 64 chars pra ArrayBuffer não-vazio', async () => {
    const buf = new TextEncoder().encode('hello world').buffer as ArrayBuffer;
    const hash = await hashMedia(buf);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // SHA-256 oficial de "hello world":
    expect(hash).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('mesmo input produz mesmo hash (consistência)', async () => {
    const a = new TextEncoder().encode('queroumacor').buffer as ArrayBuffer;
    const b = new TextEncoder().encode('queroumacor').buffer as ArrayBuffer;
    const h1 = await hashMedia(a);
    const h2 = await hashMedia(b);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('input vazio retorna string vazia', async () => {
    const buf = new ArrayBuffer(0);
    const hash = await hashMedia(buf);
    expect(hash).toBe('');
  });

  it('aceita Blob como input', async () => {
    const blob = new Blob(['hello world'], { type: 'text/plain' });
    const hash = await hashMedia(blob);
    expect(hash).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});

// ── checkHashBlocklist ───────────────────────────────────────────────

describe('checkHashBlocklist', () => {
  it('happy path: hit retorna { blocked: true, category, id }', async () => {
    const fetchMock: Mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toContain('/rest/v1/media_hash_blocklist');
      expect(url).toContain('hash=eq.abc123');
      return new Response(
        JSON.stringify([{ id: 'block-uuid', category: 'csam' }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await checkHashBlocklist('abc123');
    expect(result.blocked).toBe(true);
    expect(result.category).toBe('csam');
    expect(result.id).toBe('block-uuid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('miss (lista vazia) retorna blocked=false', async () => {
    globalThis.fetch = (vi.fn(
      async () =>
        new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown) as typeof globalThis.fetch;
    const result = await checkHashBlocklist('abc123');
    expect(result.blocked).toBe(false);
    expect(result.category).toBeUndefined();
  });

  it('hash vazio retorna blocked=false sem chamar fetch', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const result = await checkHashBlocklist('');
    expect(result.blocked).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem SUPABASE_SERVICE_ROLE_KEY → fail-open (blocked=false)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const result = await checkHashBlocklist('abc123');
    expect(result.blocked).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro de rede → fail-open (blocked=false)', async () => {
    globalThis.fetch = (vi.fn(async () => {
      throw new Error('network down');
    }) as unknown) as typeof globalThis.fetch;
    const result = await checkHashBlocklist('abc123');
    expect(result.blocked).toBe(false);
  });

  it('status não-ok → fail-open (blocked=false)', async () => {
    globalThis.fetch = (vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown) as typeof globalThis.fetch;
    const result = await checkHashBlocklist('abc123');
    expect(result.blocked).toBe(false);
  });
});

// ── enqueueMediaReview ───────────────────────────────────────────────

describe('enqueueMediaReview', () => {
  it('faz POST correto pra /rest/v1/media_review_queue', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchMock: Mock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        capturedInit = init;
        return new Response('', { status: 201 });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await enqueueMediaReview({
      postId: 'post-uuid',
      userId: 'user-uuid',
      mediaUrl: 'https://test.supabase.co/storage/v1/object/public/posts/foo.jpg',
      mediaHash: 'deadbeef',
      reason: 'gemini_flagged',
      severity: 'high',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(`${SUPA_URL_TEST}/rest/v1/media_review_queue`);
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['apikey']).toBe('svc-test');
    expect(headers['Authorization']).toBe('Bearer svc-test');
    expect(headers['Prefer']).toBe('return=minimal');

    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toMatchObject({
      post_id: 'post-uuid',
      user_id: 'user-uuid',
      media_url:
        'https://test.supabase.co/storage/v1/object/public/posts/foo.jpg',
      media_hash: 'deadbeef',
      reason: 'gemini_flagged',
      severity: 'high',
      status: 'pending',
    });
  });

  it('sem postId → omite post_id no payload', async () => {
    let capturedBody = '';
    globalThis.fetch = (vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response('', { status: 201 });
      },
    ) as unknown) as typeof globalThis.fetch;

    await enqueueMediaReview({
      postId: null,
      userId: 'user-uuid',
      mediaUrl: 'https://test.supabase.co/storage/v1/object/public/posts/foo.jpg',
      mediaHash: 'cafe',
      reason: 'manual',
      severity: 'med',
    });

    const body = JSON.parse(capturedBody);
    expect(body.post_id).toBeUndefined();
    expect(body.user_id).toBe('user-uuid');
  });

  it('sem userId → no-op (não chama fetch)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await enqueueMediaReview({
      postId: 'p',
      userId: '',
      mediaUrl: 'u',
      mediaHash: 'h',
      reason: 'x',
      severity: 'low',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem service key → no-op (não chama fetch)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await enqueueMediaReview({
      postId: 'p',
      userId: 'u',
      mediaUrl: 'm',
      mediaHash: 'h',
      reason: 'x',
      severity: 'low',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha silenciosa em erro de rede (não throws)', async () => {
    globalThis.fetch = (vi.fn(async () => {
      throw new Error('boom');
    }) as unknown) as typeof globalThis.fetch;
    await expect(
      enqueueMediaReview({
        postId: 'p',
        userId: 'u',
        mediaUrl: 'm',
        mediaHash: 'h',
        reason: 'x',
        severity: 'low',
      }),
    ).resolves.toBeUndefined();
  });
});
