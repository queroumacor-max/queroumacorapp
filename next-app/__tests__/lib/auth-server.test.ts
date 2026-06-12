// __tests__/lib/auth-server.test.ts — tests do guard CRIT-4
// (audit 2026-06-12) que protege RSCs do panel /admin/*.
//
// Estratégia: mocka `next/headers` (cookies) e `next/navigation`
// (notFound), e o fetch global. Cenários:
//   1. Sem cookie → notFound() chamado.
//   2. Cookie com formato inválido (não-JWT) → notFound().
//   3. Cookie válido mas /auth/v1/user retorna 401 → notFound().
//   4. JWT válido + email NÃO admin + profile sem flags → notFound().
//   5. JWT válido + email em ADMIN_EMAILS → retorna { userId, email }.
//   6. JWT válido + profile.portal_access=true → retorna { userId, email }.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

// Estado mutável dos mocks por teste.
let mockCookieValue: string | undefined;
const notFoundCalls: number[] = [];

class NotFoundError extends Error {
  constructor() {
    super('NEXT_NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'sb-session-token' && mockCookieValue
        ? { value: mockCookieValue, name }
        : undefined,
    getAll: () => [],
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    notFoundCalls.push(Date.now());
    throw new NotFoundError();
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

// JWT shape (3 segmentos). Valor de header/payload/sig é irrelevante aqui — a
// validação real é feita pelo Supabase, que mocamos.
const VALID_JWT = 'aaa.bbb.ccc';

beforeEach(() => {
  mockCookieValue = undefined;
  notFoundCalls.length = 0;
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
  process.env.ADMIN_EMAILS = 'boss@x.com, sec@x.com';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('requireAdminServer', () => {
  it('sem cookie → notFound()', async () => {
    mockCookieValue = undefined;
    globalThis.fetch = vi.fn(); // não deve ser chamado
    const { requireAdminServer } = await import('@/lib/auth-server');
    await expect(requireAdminServer()).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalls.length).toBeGreaterThan(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('cookie com formato inválido (não-JWT) → notFound()', async () => {
    mockCookieValue = 'nao-eh-jwt';
    globalThis.fetch = vi.fn();
    const { requireAdminServer } = await import('@/lib/auth-server');
    await expect(requireAdminServer()).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalls.length).toBeGreaterThan(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('cookie válido mas /auth/v1/user retorna 401 → notFound()', async () => {
    mockCookieValue = VALID_JWT;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(new Response('', { status: 401 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { requireAdminServer } = await import('@/lib/auth-server');
    await expect(requireAdminServer()).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalls.length).toBeGreaterThan(0);
  });

  it('JWT válido + email NÃO admin + profile sem flags → notFound()', async () => {
    mockCookieValue = VALID_JWT;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'user-1', email: 'rando@x.com' }),
            { status: 200 }
          )
        );
      }
      if (url.includes('/rest/v1/profiles')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { portal_access: false, is_admin: false, role: 'user' },
            ]),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { requireAdminServer } = await import('@/lib/auth-server');
    await expect(requireAdminServer()).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalls.length).toBeGreaterThan(0);
  });

  it('JWT válido + email em ADMIN_EMAILS → retorna { userId, email }', async () => {
    mockCookieValue = VALID_JWT;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'admin-1', email: 'BOSS@x.com' }),
            { status: 200 }
          )
        );
      }
      // profile fetch não deveria ser chamado pra admin-by-email; mas se
      // for, retornar 200 vazio.
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { requireAdminServer } = await import('@/lib/auth-server');
    const result = await requireAdminServer();
    expect(result).toEqual({ userId: 'admin-1', email: 'boss@x.com' });
    expect(notFoundCalls.length).toBe(0);
  });

  it('JWT válido + profile.portal_access=true → retorna { userId, email }', async () => {
    mockCookieValue = VALID_JWT;
    // Limpa ADMIN_EMAILS pra forçar caminho do profile.
    process.env.ADMIN_EMAILS = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'portal-1', email: 'portal@x.com' }),
            { status: 200 }
          )
        );
      }
      if (url.includes('/rest/v1/profiles')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { portal_access: true, is_admin: false, role: 'user' },
            ]),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { requireAdminServer } = await import('@/lib/auth-server');
    const result = await requireAdminServer();
    expect(result).toEqual({ userId: 'portal-1', email: 'portal@x.com' });
    expect(notFoundCalls.length).toBe(0);
  });

  it('JWT válido + profile.role=admin → retorna ok', async () => {
    mockCookieValue = VALID_JWT;
    process.env.ADMIN_EMAILS = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'role-admin', email: 'role@x.com' }),
            { status: 200 }
          )
        );
      }
      if (url.includes('/rest/v1/profiles')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { portal_access: false, is_admin: false, role: 'admin' },
            ]),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { requireAdminServer } = await import('@/lib/auth-server');
    const result = await requireAdminServer();
    expect(result).toEqual({ userId: 'role-admin', email: 'role@x.com' });
  });

  it('profile REST falha + email não-admin → notFound (fail-CLOSED)', async () => {
    mockCookieValue = VALID_JWT;
    process.env.ADMIN_EMAILS = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'failing-1', email: 'failing@x.com' }),
            { status: 200 }
          )
        );
      }
      if (url.includes('/rest/v1/profiles')) {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const { requireAdminServer } = await import('@/lib/auth-server');
    await expect(requireAdminServer()).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundCalls.length).toBeGreaterThan(0);
  });
});
