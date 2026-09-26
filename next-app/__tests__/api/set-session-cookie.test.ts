// Auditoria 2026-09-26: login-CSRF em /api/auth/set-session-cookie. Um form
// cross-site (text/plain, sem preflight) postava o token do ATACANTE e o
// navegador da vítima gravava a sessão dele. Agora: só application/json,
// Origin só do próprio app, e cookie SameSite=Strict.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/security', () => ({
  enforceRateLimit: async () => null,
  resolveSupabaseEnv: () => ({ url: 'https://ref.supabase.co', anonKey: 'anon' }),
}));

import { POST, DELETE } from '@/app/api/auth/set-session-cookie/route';

const TOKEN = 'aaa.bbb.ccc';

function req(headers: Record<string, string>, body = JSON.stringify({ accessToken: TOKEN })) {
  return new NextRequest('https://queroumacor.com.br/api/auth/set-session-cookie', {
    method: 'POST',
    headers,
    body,
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ id: 'u1' }), { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('set-session-cookie POST', () => {
  it('recusa text/plain (form cross-site) com 415, sem consultar o Supabase', async () => {
    const res = await POST(req({ 'content-type': 'text/plain' }));
    expect(res.status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recusa sem Content-Type com 415', async () => {
    const r = new NextRequest('https://queroumacor.com.br/api/auth/set-session-cookie', {
      method: 'POST',
      body: new Blob([JSON.stringify({ accessToken: TOKEN })]),
    });
    expect((await POST(r)).status).toBe(415);
  });

  it('recusa Origin de terceiro com 403', async () => {
    const res = await POST(
      req({ 'content-type': 'application/json', origin: 'https://evil.example' }),
    );
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aceita JSON da origem de produção e grava cookie Strict', async () => {
    const res = await POST(
      req({ 'content-type': 'application/json', origin: 'https://www.queroumacor.com.br' }),
    );
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('sb-session-token=');
    expect(sc.toLowerCase()).toContain('samesite=strict');
    expect(sc.toLowerCase()).toContain('httponly');
  });

  it('aceita a própria origem da request (preview/dev) e sem Origin', async () => {
    const preview = new NextRequest('https://abc.queroumacor-next.pages.dev/api/auth/set-session-cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', origin: 'https://abc.queroumacor-next.pages.dev' },
      body: JSON.stringify({ accessToken: TOKEN }),
    });
    expect((await POST(preview)).status).toBe(200);
    expect((await POST(req({ 'content-type': 'application/json' }))).status).toBe(200);
  });
});

describe('set-session-cookie DELETE', () => {
  it('limpa com SameSite=Strict', async () => {
    const res = await DELETE();
    const sc = (res.headers.get('set-cookie') ?? '').toLowerCase();
    expect(sc).toContain('max-age=0');
    expect(sc).toContain('samesite=strict');
  });
});
