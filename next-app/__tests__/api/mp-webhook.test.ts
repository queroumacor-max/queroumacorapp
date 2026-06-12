// __tests__/api/mp-webhook.test.ts — testes do webhook crítico do MP.
// Cobertura alvo >85% — exercita HMAC, idempotência, anti-fraude, retry,
// edge cases de parsing.
//
// Notes:
//   - HMAC: testes geram assinatura válida com Web Crypto (mesma lib usada
//     pelo service), garantindo paridade bit-a-bit. Falsa = string aleatória.
//   - GET / signature missing → 401 (sinaliza barrado).
//   - Quase tudo retorna 200 (anti-retry storm).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

const WEBHOOK_SECRET = 'test-webhook-secret-abc123';

/**
 * Helper pra setar NODE_ENV em test (next/@types/node 22 marca como readonly).
 * Bracket-access bypassa o readonly do tipo NodeJS.ProcessEnv.NODE_ENV.
 */
function setNodeEnv(value: 'production' | 'development' | 'test'): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

async function sign(manifest: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(manifest)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constrói um Request com assinatura HMAC válida pro body+headers fornecidos.
 */
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
    reqId = 'req-1',
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

function mkRawReq(opts: {
  rawBody: string;
  headers?: Record<string, string>;
  url?: string;
}): NextRequest {
  const {
    rawBody,
    headers = {},
    url = 'https://app.test/api/mp-webhook',
  } = opts;
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
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

describe('POST /api/mp-webhook — HMAC signature', () => {
  it('rejects with 401 when x-signature header missing', async () => {
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({ type: 'payment', data: { id: '123' } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid signature');
  });

  it('rejects with 401 when HMAC mismatch', async () => {
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({ type: 'payment', data: { id: '123' } }),
      headers: {
        'x-signature': 'ts=1700000000,v1=deadbeef',
        'x-request-id': 'req-1',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects with 401 when ts or v1 missing in signature', async () => {
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({ type: 'payment', data: { id: '123' } }),
      headers: {
        'x-signature': 'foo=bar',
        'x-request-id': 'req-1',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('fail-open: accepts unsigned when MP_WEBHOOK_SECRET unset and ENFORCE off (dev)', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_WEBHOOK_ENFORCE;
    // NODE_ENV=test em vitest, mas garantimos != production
    setNodeEnv('development');
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({ type: 'something_ignored' }),
    });
    const res = await POST(req);
    // sem signature, mas fail-open → segue até ignorar o evento
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/ignorado/);
  });

  it('fail-closed: rejects with 401 when MP_WEBHOOK_ENFORCE=true and secret missing', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.MP_WEBHOOK_ENFORCE = 'true';
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({ type: 'payment', data: { id: '123' } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('GET returns 200 for MP validation ping', async () => {
    const { GET } = await import('@/app/api/mp-webhook/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.msg).toMatch(/ativo/);
  });
});

// CRIT-2 (2026-06-12) — fail-closed em produção sem MP_WEBHOOK_SECRET.
// Antes: sem secret + sem ENFORCE → fail-open (atacante forjava webhook).
// Agora: NODE_ENV=production sem secret → 401 sempre.
describe('POST /api/mp-webhook — CRIT-2 fail-closed em produção', () => {
  it('fail-closed: NODE_ENV=production sem MP_WEBHOOK_SECRET → 401', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_WEBHOOK_ENFORCE;
    setNodeEnv('production');
    const { POST } = await import('@/app/api/mp-webhook/route');
    // Payload de ativação maliciosa: type=preapproval + status=authorized.
    // Sem secret, atacante forjaria isso pra liberar PRO. Tem que dar 401.
    const req = mkRawReq({
      rawBody: JSON.stringify({
        type: 'preapproval',
        data: { id: 'pre-evil' },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid signature');
  });

  it('fail-closed em prod NÃO chama MP API nem Supabase (fetchMock untouched)', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    setNodeEnv('production');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({
        type: 'preapproval',
        data: { id: 'pre-evil' },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    // Nenhum side-effect: HMAC barra antes de qualquer fetch.
    // (logAuditEvent pode ter chamado fetch internamente — mas como
    //  service key está set, ele pode tentar. Verificamos que nenhuma
    //  call de MP API ou orders/profiles PATCH aconteceu.)
    const mpCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('mercadopago.com')
    );
    expect(mpCalls).toHaveLength(0);
    const profilePatch = fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/rest/v1/profiles') &&
        init?.method === 'PATCH'
    );
    expect(profilePatch).toHaveLength(0);
  });

  it('fail-open: NODE_ENV=development sem secret/enforce permite passar (UX local)', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.MP_WEBHOOK_ENFORCE;
    setNodeEnv('development');
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({ type: 'something_ignored' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/ignorado/);
  });

  it('fail-closed em dev quando MP_WEBHOOK_ENFORCE=true mesmo sem secret', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.MP_WEBHOOK_ENFORCE = 'true';
    setNodeEnv('development');
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = mkRawReq({
      rawBody: JSON.stringify({ type: 'payment', data: { id: '1' } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('com secret + signature válida em production → segue normal (não bloqueia)', async () => {
    process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET;
    setNodeEnv('production');
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'something_ignored' },
    });
    const res = await POST(req);
    // Signature válida passou; depois caiu em 'evento ignorado' (200).
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/ignorado/);
  });
});

describe('POST /api/mp-webhook — timingSafeEqualHex', () => {
  it('returns false on different length', async () => {
    const { timingSafeEqualHex } = await import('@/lib/api/_services/mp-webhook');
    expect(timingSafeEqualHex('abc', 'abcd')).toBe(false);
  });

  it('returns false on different content', async () => {
    const { timingSafeEqualHex } = await import('@/lib/api/_services/mp-webhook');
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
  });

  it('returns true on equal strings', async () => {
    const { timingSafeEqualHex } = await import('@/lib/api/_services/mp-webhook');
    expect(timingSafeEqualHex('cafe1234', 'cafe1234')).toBe(true);
  });
});

describe('POST /api/mp-webhook — config / env', () => {
  it('returns 200 with "config ausente" when MP_ACCESS_TOKEN missing', async () => {
    delete process.env.MP_ACCESS_TOKEN;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment', data: { id: '123' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/config/);
  });

  it('returns 200 with "config ausente" when service role key missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment', data: { id: '123' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/config/);
  });
});

describe('POST /api/mp-webhook — payment (order)', () => {
  it('ignores event with unknown type', async () => {
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'something_random', data: { id: '123' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/ignorado/);
  });

  it('payment.created with approved status updates order to paid', async () => {
    const fetchMock = vi
      .fn()
      // GET /v1/payments
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'ord-1',
            status: 'approved',
            transaction_amount: 100,
            payment_type_id: 'credit_card',
          }),
          { status: 200 }
        )
      )
      // GET /rest/v1/orders
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'ord-1', total: 100, status: 'pending', tx_id: null },
          ]),
          { status: 200 }
        )
      )
      // PATCH /rest/v1/orders
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment.created', data: { id: 'pay-123' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe('order paid');
    // Patch enviado tem status=paid + tx_id
    const patchCall = fetchMock.mock.calls[2];
    expect(patchCall[1].method).toBe('PATCH');
    const sent = JSON.parse(patchCall[1].body);
    expect(sent.status).toBe('paid');
    expect(sent.tx_id).toBe('pay-123');
  });

  it('idempotent: already-paid order with same tx_id is no-op', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'ord-1',
            status: 'approved',
            transaction_amount: 100,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'ord-1', total: 100, status: 'paid', tx_id: 'pay-123' },
          ]),
          { status: 200 }
        )
      );
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment', data: { id: 'pay-123' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe('idempotente');
    // NUNCA chamou PATCH — só GET payment + GET order (2 calls total)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('anti-fraud: payment amount mismatch marks order as amount_mismatch (not paid)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'ord-1',
            status: 'approved',
            transaction_amount: 1, // PAGOU R$1 PRA UM PEDIDO DE R$100
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'ord-1', total: 100, status: 'pending', tx_id: null },
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment', data: { id: 'pay-456' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe('order amount_mismatch');
    const patch = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(patch.status).toBe('amount_mismatch');
    expect(patch.paid_amount).toBe(1);
  });

  it('payment.refunded marks order as refunded', async () => {
    // Order foi paga com tx_id antigo, agora chega evento de refund com novo id
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'ord-1',
            status: 'refunded',
            transaction_amount: 100,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'ord-1', total: 100, status: 'paid', tx_id: 'pay-original' },
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment', data: { id: 'pay-refund' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe('order refunded');
  });

  it('payment without external_reference is skipped', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'approved' }), { status: 200 })
      );
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment', data: { id: 'pay-x' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/external_reference/);
  });

  it('MP API down on payment fetch: return 200 (anti-retry storm)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment', data: { id: 'pay-x' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/mp payment 500/);
  });
});

describe('POST /api/mp-webhook — preapproval (PRO)', () => {
  it('authorized with valid amount activates PRO', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-uuid-1',
            status: 'authorized',
            auto_recurring: {
              transaction_amount: 39,
              currency_id: 'BRL',
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-1' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe('ok');
    const patch = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(patch.is_pro).toBe(true);
    expect(patch.mp_preapproval_id).toBe('pre-1');
    expect(typeof patch.pro_expires_at).toBe('string');
  });

  it('anti-fraud: preapproval with R$1 instead of R$39 does NOT activate PRO', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-uuid-1',
            status: 'authorized',
            auto_recurring: {
              transaction_amount: 1,
              currency_id: 'BRL',
            },
          }),
          { status: 200 }
        )
      );
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-evil' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/valor diferente/);
    // NÃO chamou PATCH em profiles
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('anti-fraud: currency != BRL rejects activation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-uuid-1',
            status: 'authorized',
            auto_recurring: {
              transaction_amount: 39,
              currency_id: 'USD',
            },
          }),
          { status: 200 }
        )
      );
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-usd' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancelled preapproval deactivates PRO', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-uuid-1',
            status: 'cancelled',
            auto_recurring: { transaction_amount: 39, currency_id: 'BRL' },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-cancel' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const patch = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(patch.is_pro).toBe(false);
    expect(patch.pro_expires_at).toBeNull();
  });

  it('pending preapproval is no-op (does NOT touch is_pro)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'user-uuid-1',
            status: 'pending',
            auto_recurring: { transaction_amount: 39, currency_id: 'BRL' },
          }),
          { status: 200 }
        )
      );
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-pending' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/pending/);
    // SÓ a chamada do MP, nenhum PATCH
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preapproval without external_reference is skipped', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'authorized',
            auto_recurring: { transaction_amount: 39, currency_id: 'BRL' },
          }),
          { status: 200 }
        )
      );
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'preapproval', data: { id: 'pre-x' } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toMatch(/external_reference/);
  });
});

describe('POST /api/mp-webhook — body parsing edge cases', () => {
  it('handles non-JSON body: extracts type/id from querystring', async () => {
    // Sem JSON no body, mas com ?type=payment&data.id=... na URL
    const url =
      'https://app.test/api/mp-webhook?type=payment&data.id=pay-from-qs';
    // dataId vai pro manifest como '' (body.data.id ausente)
    const req = await mkSignedReq({
      body: {},
      dataId: '',
      url,
    });
    // Replace body com string vazia → JSON.parse falha, body={}
    const headers = new Headers(req.headers);
    const newReq = new Request(url, {
      method: 'POST',
      headers,
      body: '',
    }) as unknown as NextRequest;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_reference: 'ord-qs',
            status: 'approved',
            transaction_amount: 50,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'ord-qs', total: 50, status: 'pending', tx_id: null },
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;
    const { POST } = await import('@/app/api/mp-webhook/route');
    const res = await POST(newReq);
    expect(res.status).toBe(200);
    // Confirma que pegou o id da querystring: chamou /v1/payments/pay-from-qs
    expect(fetchMock.mock.calls[0][0]).toContain('pay-from-qs');
  });

  it('returns 200 when event has no id (neither body nor querystring)', async () => {
    const { POST } = await import('@/app/api/mp-webhook/route');
    const req = await mkSignedReq({
      body: { type: 'payment' }, // sem data.id
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe('sem id');
  });
});
