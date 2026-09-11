// __tests__/api/admin-users.test.ts — testes do route handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/admin/users', {
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

describe('POST /api/admin/users', () => {
  it('lookup (no action) returns users matching query', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'c', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/rest/v1/profiles')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 'u1', name: 'Foo' }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', query: 'foo' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users[0].id).toBe('u1');
  });

  it('promote action PATCHes portal_access=true when caller has portal_access', async () => {
    let patchBody = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      // caller portal_access check
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') {
        patchBody = String(init.body);
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 'target' }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'promote', userId: 'target' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(patchBody).toContain('portal_access');
    expect(patchBody).toContain('true');
  });

  // O telefone que o portal grava tem que sair no MESMO formato que o app
  // grava (digitos com o DDI 55). Com mascara, o numero deixaria de casar
  // com as conversas do WhatsApp e com os leads, que comparam digitos.
  it('set_info normaliza o telefone com mascara para digitos com o 55', async () => {
    let patchBody = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') {
        patchBody = String(init.body);
        return Promise.resolve(new Response(JSON.stringify([{ id: 'target' }]), { status: 200 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'set_info', userId: 'target', phone: '(11) 95976-5031' })
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(patchBody)).toEqual({ phone: '5511959765031' });
  });

  it('set_info com telefone vazio LIMPA o campo (null)', async () => {
    let patchBody = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') {
        patchBody = String(init.body);
        return Promise.resolve(new Response(JSON.stringify([{ id: 'target' }]), { status: 200 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'set_info', userId: 'target', phone: '   ' })
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(patchBody)).toEqual({ phone: null });
  });

  // Numero ESTRANGEIRO nao pode ganhar '55': foi assim que o contato dos
  // EUA 16503154274 virou 5516503154274 (inexistente) e derrubou o envio
  // do WhatsApp com 502. Mesma regra de `normalizeWhatsAppTarget`.
  it('set_info guarda numero estrangeiro verbatim, sem colar o 55', async () => {
    let patchBody = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') {
        patchBody = String(init.body);
        return Promise.resolve(new Response(JSON.stringify([{ id: 'target' }]), { status: 200 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'set_info', userId: 'target', phone: '+1 650 315-4274' })
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(patchBody)).toEqual({ phone: '16503154274' });
  });

  it('set_info recusa telefone com contagem de digitos impossivel', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'set_info', userId: 'target', phone: '123' })
    );
    expect(res.status).toBe(400);
  });

  it('caller in ADMIN_EMAILS but without portal_access returns 403', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: false }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'promote', userId: 'target' })
    );
    expect(res.status).toBe(403);
  });

  it('sync_email reveals the Auth login email and mirrors it into profiles', async () => {
    let mirrorBody = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/auth/v1/admin/users/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'target', email: 'Bianca@Mail.com' }), { status: 200 })
        );
      }
      if (url.includes('/rest/v1/profiles') && init?.method === 'PATCH') {
        mirrorBody = String(init.body);
        return Promise.resolve(new Response('[{"id":"target"}]', { status: 200 }));
      }
      if (url.includes('/rest/v1/profiles')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'sync_email', userId: 'target' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe('bianca@mail.com');
    expect(body.source).toBe('auth');
    expect(JSON.parse(mirrorBody).email).toBe('bianca@mail.com');
  });

  it('sync_email 404s when the profile has no Auth login and no mirrored email', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/auth/v1/admin/users/')) {
        return Promise.resolve(new Response('{"msg":"not found"}', { status: 404 }));
      }
      if (url.includes('/rest/v1/profiles') && url.includes('select=email')) {
        return Promise.resolve(new Response(JSON.stringify([{ email: null }]), { status: 200 }));
      }
      if (url.includes('/rest/v1/profiles')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'sync_email', userId: 'orphan' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/órfão/);
  });

  it('invalid action returns 400', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      // Sem esta linha o caller não tem portal_access e a rota devolve 403
      // ANTES de olhar a action — foi o que quebrou este teste. A ordem é
      // proposital (autorização antes de validar payload) e está coberta
      // pelo teste seguinte.
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'bogus', userId: 'target' })
    );
    expect(res.status).toBe(400);
  });

  it('caller sem portal_access leva 403 — autorização vem antes de validar a action', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 })
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: false }]), { status: 200 })
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'promote', userId: 'target' })
    );
    expect(res.status).toBe(403);
  });
});

// ─── set_email: takeover de conta com poder (auditoria 2026-09-11) ─────────
//
// Trocar o login de alguém sem confirmação é tomar a conta ("esqueci a
// senha" no endereço novo). Um operador promovido no portal não pode fazer
// isso com um admin, nem consigo mesmo.
function fetchParaSetEmail(opts: {
  alvo?: { portal_access?: boolean; role?: string | null };
  loginDoAlvo?: string | null;
  callerId?: string;
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method || 'GET' });
    if (url.includes('/auth/v1/user')) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: opts.callerId ?? 'caller', email: 'boss@x.com' }), {
          status: 200,
        }),
      );
    }
    if (url.includes('/rpc/check_rate_limit')) {
      return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
    }
    if (url.includes('id=eq.target') && url.includes('select=portal_access,role')) {
      return Promise.resolve(
        new Response(JSON.stringify([opts.alvo ?? { portal_access: false, role: 'pintor' }]), {
          status: 200,
        }),
      );
    }
    if (url.includes(`id=eq.${opts.callerId ?? 'caller'}`) && url.endsWith('select=portal_access')) {
      return Promise.resolve(new Response(JSON.stringify([{ portal_access: true }]), { status: 200 }));
    }
    if (url.includes('/auth/v1/admin/users/target') && (init?.method || 'GET') === 'GET') {
      if (opts.loginDoAlvo === null) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'target', email: opts.loginDoAlvo ?? 'user@x.com' }), {
          status: 200,
        }),
      );
    }
    if (url.includes('/auth/v1/admin/users/target') && init?.method === 'PUT') {
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
    if (url.includes('/rest/v1/profiles?id=eq.target') && init?.method === 'PATCH') {
      return Promise.resolve(new Response(JSON.stringify([{ id: 'target' }]), { status: 200 }));
    }
    return Promise.resolve(new Response('[]', { status: 200 }));
  });
  globalThis.fetch = f;
  return calls;
}

describe('POST /api/admin/users — set_email não toma conta com poder', () => {
  it('alvo com portal_access → 403 e o Auth NÃO é tocado', async () => {
    const calls = fetchParaSetEmail({ alvo: { portal_access: true, role: 'pintor' } });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'set_email', userId: 'target', email: 'novo@x.com' }));
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('alvo com login em ADMIN_EMAILS (mesmo sem flag no perfil) → 403', async () => {
    const calls = fetchParaSetEmail({ loginDoAlvo: 'boss@x.com' });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'set_email', userId: 'target', email: 'novo@x.com' }));
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('a própria conta → 400 (troca de e-mail própria é pelo fluxo com confirmação)', async () => {
    const calls = fetchParaSetEmail({ callerId: 'target' });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'set_email', userId: 'target', email: 'novo@x.com' }));
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('falha ao ler o alvo → 502, nada alterado (fail-closed)', async () => {
    fetchParaSetEmail({});
    const base = globalThis.fetch as ReturnType<typeof vi.fn>;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('id=eq.target') && url.includes('select=portal_access,role')) {
        return Promise.resolve(new Response('erro', { status: 500 }));
      }
      return base(url, init);
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'set_email', userId: 'target', email: 'novo@x.com' }));
    expect(res.status).toBe(502);
  });

  it('alvo comum → troca o login no Auth e espelha no perfil', async () => {
    const calls = fetchParaSetEmail({});
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(mkReq({ accessToken: 'good', action: 'set_email', userId: 'target', email: 'Novo@X.com' }));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/auth/v1/admin/users/target'))).toBe(true);
    expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/profiles?id=eq.target'))).toBe(true);
  });
});
