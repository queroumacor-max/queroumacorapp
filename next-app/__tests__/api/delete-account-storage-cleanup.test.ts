// __tests__/api/delete-account-storage-cleanup.test.ts
//
// Auditoria de privacidade 2026-09-17: nenhum dos dois caminhos de
// exclusão de conta (este endpoint e a RPC SQL `admin_delete_user`)
// apagava ARQUIVO nenhum do Storage — o profile ficava anonimizado no
// banco, mas avatar/arte publicada continuavam baixáveis pra sempre pela
// URL pública antiga (bucket público, path `<uid>/...`). Este teste prova
// que `/api/delete-account` agora lista e remove os objetos do usuário
// nos buckets `avatars`/`art-refs`/`posts` antes de responder, e que uma
// 2ª tentativa de DELETE do `auth.users` acontece antes de desistir e
// gravar um registro visível em `errors` pro time de operação.

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

describe('POST /api/delete-account — limpeza de Storage', () => {
  it('lista e remove os arquivos do usuário nos 3 buckets (avatars/art-refs/posts)', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'user-1', email: 'x@y.com' }), { status: 200 }),
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/storage/v1/object/list/avatars')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: 'foto.webp' }]), { status: 200 }),
        );
      }
      if (url.includes('/storage/v1/object/list/')) {
        return Promise.resolve(new Response('[]', { status: 200 }));
      }
      if (url.includes('/storage/v1/object/remove/')) {
        return Promise.resolve(new Response('[]', { status: 200 }));
      }
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/delete-account/route');
    const res = await POST(mkReq({ accessToken: 'good' }));
    expect(res.status).toBe(200);

    const listCalls = calls.filter((c) => c.url.includes('/storage/v1/object/list/'));
    const listedBuckets = listCalls.map((c) => c.url.split('/storage/v1/object/list/')[1]);
    expect(listedBuckets.sort()).toEqual(['art-refs', 'avatars', 'posts'].sort());

    const removeCall = calls.find((c) => c.url.includes('/storage/v1/object/remove/avatars'));
    expect(removeCall).toBeDefined();
    const removedBody = JSON.parse(removeCall!.body!);
    expect(removedBody.prefixes).toEqual(['user-1/foto.webp']);

    // Buckets sem arquivo do usuário não chamam remove (lista vazia).
    expect(calls.some((c) => c.url.includes('/storage/v1/object/remove/art-refs'))).toBe(false);
  });

  it('falha ao listar/remover Storage não bloqueia o resto da exclusão (best-effort)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'user-1', email: 'x@y.com' }), { status: 200 }),
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/storage/v1/object/list/')) {
        return Promise.reject(new Error('network down'));
      }
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/delete-account/route');
    const res = await POST(mkReq({ accessToken: 'good' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('POST /api/delete-account — retry + registro visível quando GoTrue DELETE falha de vez', () => {
  it('tenta o DELETE do auth.users DUAS vezes antes de desistir', async () => {
    let deleteAttempts = 0;
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
        deleteAttempts++;
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/delete-account/route');
    await POST(mkReq({ accessToken: 'good' }));
    expect(deleteAttempts).toBe(2);
  });

  it('quando as 2 tentativas falham, grava um registro em `errors` (type account-deletion-incomplete)', async () => {
    const calls: { url: string; body?: string }[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'user-1', email: 'x@y.com' }), { status: 200 }),
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('/auth/v1/admin/users/') && init?.method === 'DELETE') {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/delete-account/route');
    const res = await POST(mkReq({ accessToken: 'good' }));
    // Resposta ao cliente continua ok — decisão deliberada e preexistente.
    expect(res.status).toBe(200);

    const errCall = calls.find((c) => c.url.endsWith('/rest/v1/errors'));
    expect(errCall).toBeDefined();
    const row = JSON.parse(errCall!.body!);
    expect(row.type).toBe('account-deletion-incomplete');
    expect(row.user_id).toBe('user-1');
  });

  it('quando o DELETE funciona de primeira, NÃO grava registro em `errors`', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push(url);
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
    await POST(mkReq({ accessToken: 'good' }));
    expect(calls.some((u) => u.endsWith('/rest/v1/errors'))).toBe(false);
  });
});
