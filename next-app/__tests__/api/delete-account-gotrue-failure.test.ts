// Teste adversarial: falha do GoTrue ao deletar `auth.users` não pode
// mais ser silenciosa.
//
// Auditoria de negócio 2026-09-16: o `await fetch(.../auth/v1/admin/users/
// {id}, {method:'DELETE'})` nunca checava `res.ok` — só um erro de REDE
// (exceção) caía no catch. Um 4xx/5xx do GoTrue (permissão, falha
// transitória) passava batido, e o endpoint respondia `{ok:true}` mesmo
// com a conta ainda existindo no auth — sessão/token da "conta excluída"
// continuavam válidos (requireAuth revalida contra o GoTrue VIVO a cada
// chamada, então nada morre sozinho até expirar naturalmente). Este teste
// prova que a falha agora é logada (visível pra operação) mesmo que a
// resposta ao cliente continue `{ok:true}` (perfil já foi anonimizado —
// decisão deliberada, ver comentário no route.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/delete-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('POST /api/delete-account — visibilidade de falha do GoTrue DELETE', () => {
  it('GoTrue DELETE retornando 500 é logado via console.error (antes: silencioso)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'user-1', email: 'x@y.com' }), { status: 200 }),
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') {
        return Promise.resolve(new Response('internal error', { status: 500 }));
      }
      // Cascatas de soft-delete, anonimização de profile, audit_log — tudo
      // best-effort, aceita qualquer chamada com 200 vazio.
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/delete-account/route');
    const res = await POST(mkReq({ accessToken: 'good' }));

    // A resposta ao cliente continua ok — o perfil já foi anonimizado, e
    // isso é uma decisão deliberada (ver comentário no route.ts), não um
    // bug. O que muda é que a falha agora é VISÍVEL.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const loggedFailure = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === 'string' &&
          arg.includes('delete-account') &&
          arg.toLowerCase().includes('gotrue'),
      ),
    );
    expect(loggedFailure).toBe(true);
  });

  it('GoTrue DELETE bem-sucedido (204) não loga erro nenhum', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'user-1', email: 'x@y.com' }), { status: 200 }),
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/delete-account/route');
    const res = await POST(mkReq({ accessToken: 'good' }));

    expect(res.status).toBe(200);
    const loggedGoTrueFailure = errorSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.toLowerCase().includes('gotrue')),
    );
    expect(loggedGoTrueFailure).toBe(false);
  });
});
