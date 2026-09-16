// __tests__/api/admin-moderate.test.ts — testes do route handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/admin/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

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

describe('POST /api/admin/moderate', () => {
  it('approve action PATCHes status=approved and returns ok:true', async () => {
    let patchBody = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/posts') && init?.method === 'PATCH') {
        patchBody = String(init.body);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/moderate/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'approve', postId: 'p1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(patchBody).toContain('approved');
  });

  it('reject action DELETEs the post', async () => {
    let deleted = false;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/posts') && init?.method === 'DELETE') {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      // GET media_url returns no rows
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/moderate/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'reject', postId: 'p1' }));
    expect(res.status).toBe(200);
    expect(deleted).toBe(true);
  });

  it('action=check returns admin flag without enforcing admin', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'rando@x.com' }), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/moderate/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'check' }));
    expect(res.status).toBe(200);
    expect((await res.json()).admin).toBe(false);
  });

  it('non-admin trying approve returns 403', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'rando@x.com' }), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/moderate/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'approve', postId: 'p1' }));
    expect(res.status).toBe(403);
  });

  // Auditoria de negócio 2026-09-16: `reject` é irreversível (hard delete
  // de post + mídia alheia). `ensurePortalAdmin` cacheia "é admin?" por 60s
  // por isolate — uma conta despromovida no meio dessa janela continuava
  // apagando post de qualquer um. Prova que `reject` re-checa fresco,
  // mesmo que um `approve` anterior (na mesma requisição HTTP em série,
  // simulando o mesmo isolate/janela de 60s) já tenha deixado a conta
  // marcada como admin no cache.
  it('reject re-checks admin status fresh (not the 60s cache) — a just-demoted account is rejected', async () => {
    let profileCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'demoted-caller', email: 'operator@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/profiles') && url.includes('portal_access')) {
        profileCallCount += 1;
        // 1ª leitura (durante o approve, que popula o cache de 60s do
        // ensurePortalAdmin): ainda tem portal_access. Da 2ª em diante
        // (o fresh check do reject): já foi despromovido.
        const stillAdmin = profileCallCount === 1;
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: stillAdmin, role: null }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/moderate/route');

    // 1) approve — passa (portal_access=true) e deixa `operator@x.com`
    // cacheado como admin por 60s dentro de `ensurePortalAdmin`.
    const approveRes = await POST(mkReq({ accessToken: 'good', action: 'approve', postId: 'p1' }));
    expect(approveRes.status).toBe(200);

    // 2) reject, mesma "janela" (nenhum reset de módulo/tempo entre as duas
    // chamadas) — o cache DIRIA "ainda admin", mas o fresh check de
    // ensurePortalAdminFresh lê o banco de novo e vê portal_access=false.
    const rejectRes = await POST(mkReq({ accessToken: 'good', action: 'reject', postId: 'p1' }));
    expect(rejectRes.status).toBe(403);
  });
});
