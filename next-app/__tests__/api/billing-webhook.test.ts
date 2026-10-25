import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/billing/webhook/route';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
});

function req(auth: string | null, body: unknown = { event: { type: 'TEST' } }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== null) headers.authorization = auth;
  return new NextRequest('https://queroumacor.com.br/api/billing/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('/api/billing/webhook', () => {
  it('sem segredo configurado → 503 (fechado)', async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    expect((await POST(req('x'))).status).toBe(503);
  });
  it('header errado → 401, sem tocar em nada', async () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer certo';
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await POST(req('Bearer errado'))).status).toBe(401);
    expect((await POST(req(null))).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
  it('header certo + evento sem conta nossa → 200 sem chamar ninguém', async () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer certo';
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await POST(req('Bearer certo', { event: { type: 'TEST', app_user_id: '$RCAnonymousID:a' } }));
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});
