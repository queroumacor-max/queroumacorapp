// __tests__/api/mp-webhook-cancel.test.ts — R-H12 grace period em cancel/pause.
//
// Antes: webhook `cancelled`/`paused` zerava `is_pro=false` + `pro_expires_at=null`
//        — user perdia acesso na hora, mesmo já tendo pago o mês corrente.
// Agora: `is_pro` e `pro_expires_at` ficam intactos; `pro_grace_until` recebe
//        valor do `pro_expires_at` original pra UX. `is_pro_active(uuid)`
//        (SQL Wave 7) honra `pro_grace_until` via cláusula OR, então user
//        permanece PRO até o fim do ciclo já pago.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

const WEBHOOK_SECRET = 'test-webhook-secret-cancel';

async function sign(manifest: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(manifest),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function mkSignedReq(opts: {
  body: object;
  reqId?: string;
  ts?: string;
  dataId?: string;
  secret?: string;
  url?: string;
}): Promise<NextRequest> {
  const {
    body,
    reqId = 'req-cancel',
    ts = '1700000000',
    dataId = (body as { data?: { id?: string } })?.data?.id || '',
    secret = WEBHOOK_SECRET,
    url = 'https://app.test/api/mp-webhook',
  } = opts;
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  const v1 = await sign(manifest, secret);
  const headers = new Headers({
    'content-type': 'application/json',
    'x-signature': `ts=${ts},v1=${v1}`,
    'x-request-id': reqId,
  });
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
  process.env.MP_ACCESS_TOKEN = 'mp-secret';
  process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.MP_WEBHOOK_ENFORCE;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/mp-webhook — R-H12 cancel/pause grace period', () => {
  it('cancelled: NÃO zera is_pro nem pro_expires_at, copia para pro_grace_until', async () => {
    const futureDate = '2026-09-15T00:00:00.000Z';
    const fetchMock = vi
      .fn()
      // 1. MP API: GET preapproval status=cancelled
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-cancel-1',
            status: 'cancelled',
            auto_recurring: { transaction_amount: 39, currency_id: 'BRL' },
          }),
          { status: 200 },
        ),
      )
      // 2. Supabase GET: profile.pro_expires_at futuro (ainda no ciclo pago)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ pro_expires_at: futureDate }]),
          { status: 200 },
        ),
      )
      // 3. Supabase PATCH: profile
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-cancel-grace' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const patchCall = fetchMock.mock.calls[2];
    expect(patchCall[1].method).toBe('PATCH');
    const patch = JSON.parse(patchCall[1].body);
    // is_pro: ausente do patch (não toca; trigger/admin cuida da expiração)
    expect(patch.is_pro).toBeUndefined();
    // pro_expires_at: ausente do patch (mantém expiração natural)
    expect(patch.pro_expires_at).toBeUndefined();
    // pro_grace_until: recebe valor original pra UX sinalizar "expira em"
    expect(patch.pro_grace_until).toBe(futureDate);
    // mp_preapproval_id: marca a transição pra trilha
    expect(patch.mp_preapproval_id).toBe('pre-cancel-grace');
  });

  it('paused: mesmo comportamento — mantém PRO até fim do ciclo', async () => {
    const futureDate = '2026-10-01T00:00:00.000Z';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-paused-1',
            status: 'paused',
            auto_recurring: { transaction_amount: 39, currency_id: 'BRL' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ pro_expires_at: futureDate }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-paused' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const patch = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(patch.is_pro).toBeUndefined();
    expect(patch.pro_expires_at).toBeUndefined();
    expect(patch.pro_grace_until).toBe(futureDate);
  });

  it('cancelled com profile sem pro_expires_at: grace_until vira null (patch parcial OK)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-cancel-noexp',
            status: 'cancelled',
            auto_recurring: { transaction_amount: 39, currency_id: 'BRL' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ pro_expires_at: null }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-cancel-noexp' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const patch = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(patch.pro_grace_until).toBeNull();
    // is_pro continua intacto (não mexemos)
    expect(patch.is_pro).toBeUndefined();
  });

  it('cancelled com falha no SELECT do profile: ainda envia patch parcial (resiliência)', async () => {
    // SELECT falha (500); webhook segue e faz patch sem grace_until
    // (acesso preservado por pro_expires_at intacto, que é o que importa).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-cancel-selfail',
            status: 'cancelled',
            auto_recurring: { transaction_amount: 39, currency_id: 'BRL' },
          }),
          { status: 200 },
        ),
      )
      // SELECT pro_expires_at falha
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      // PATCH ainda acontece
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-cancel-selfail' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Patch ainda acontece (3a call) — pro_grace_until vira null porque
    // SELECT falhou, mas is_pro/pro_expires_at NÃO são tocados.
    const patchCall = fetchMock.mock.calls[2];
    expect(patchCall[1].method).toBe('PATCH');
    const patch = JSON.parse(patchCall[1].body);
    expect(patch.is_pro).toBeUndefined();
    expect(patch.pro_expires_at).toBeUndefined();
    expect(patch.pro_grace_until).toBeNull();
  });
});
