// Tests do middleware lib/api/audit.ts (Grande#5).
// Cobre 5 cenários:
//   - happy path: insere payload correto em audit_log via REST com service key;
//   - IP detection: cf-connecting-ip → x-real-ip → x-forwarded-for (primeira);
//   - UA detection: user-agent capturado e truncado a 500 chars;
//   - fail-open: action vazia → skip silencioso (não bate na rede);
//   - fail-open: service key ausente → skip silencioso.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logAuditEvent } from '../../lib/api/audit';

const originalFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

function captureFetch(captured: CapturedRequest[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) Object.assign(headers, h);
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    captured.push({
      url: typeof input === 'string' ? input : input.toString(),
      method: init?.method,
      headers,
      body,
    });
    return new Response('', { status: 201 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE = 'service-test-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('logAuditEvent', () => {
  it('happy path: POST em /rest/v1/audit_log com payload e service key', async () => {
    const captured: CapturedRequest[] = [];
    globalThis.fetch = captureFetch(captured);

    await logAuditEvent({
      actorId: 'user-abc',
      action: 'admin.user.set_pro',
      targetTable: 'profiles',
      targetId: 'target-xyz',
      changes: { is_pro: { from: false, to: true } },
    });

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe('https://test.supabase.co/rest/v1/audit_log');
    expect(req.method).toBe('POST');
    expect(req.headers.apikey).toBe('service-test-key');
    expect(req.headers.Authorization).toBe('Bearer service-test-key');
    expect(req.body).toMatchObject({
      actor_id: 'user-abc',
      action: 'admin.user.set_pro',
      target_table: 'profiles',
      target_id: 'target-xyz',
      changes: { is_pro: { from: false, to: true } },
      ip_address: null,
      user_agent: null,
    });
  });

  it('IP detection: prioriza cf-connecting-ip sobre x-forwarded-for', async () => {
    const captured: CapturedRequest[] = [];
    globalThis.fetch = captureFetch(captured);

    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.42',
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
      'user-agent': 'Mozilla/5.0',
    });
    await logAuditEvent({
      actorId: 'u1',
      action: 'me.export',
      request: { headers },
    });

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body.ip_address).toBe('203.0.113.42');
    expect(body.user_agent).toBe('Mozilla/5.0');
  });

  it('IP detection fallback: x-forwarded-for primeira entrada quando cf-* ausente', async () => {
    const captured: CapturedRequest[] = [];
    globalThis.fetch = captureFetch(captured);

    const headers = new Headers({
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
    });
    await logAuditEvent({
      actorId: null,
      action: 'mp.subscription.authorized',
      request: { headers },
    });

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body.ip_address).toBe('198.51.100.1');
  });

  it('UA detection: truncado a 500 chars (defensivo)', async () => {
    const captured: CapturedRequest[] = [];
    globalThis.fetch = captureFetch(captured);

    const longUa = 'X'.repeat(1000);
    const headers = new Headers({ 'user-agent': longUa });
    await logAuditEvent({
      actorId: 'u1',
      action: 'admin.style_ref.upload',
      request: { headers },
    });

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body as Record<string, unknown>;
    expect((body.user_agent as string).length).toBe(500);
  });

  it('fail-open: action vazia → skip silencioso (não bate na rede)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await logAuditEvent({
      actorId: 'u1',
      action: '',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fail-open: SUPABASE_SERVICE_ROLE ausente → skip silencioso', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await logAuditEvent({
      actorId: 'u1',
      action: 'admin.test',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fail-open: erro de rede vira console.warn, nunca throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'admin.test',
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
