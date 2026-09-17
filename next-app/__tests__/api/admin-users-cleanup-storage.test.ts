// __tests__/api/admin-users-cleanup-storage.test.ts
//
// Auditoria de privacidade 2026-09-17: a RPC `admin_delete_user` (SQL
// puro, chamada pelo portal pra excluir conta) NUNCA conseguiu apagar
// arquivo nenhum do Storage — avatar/arte da conta excluída ficavam
// públicos pra sempre. Esta action nova (`cleanup_storage`) é chamada
// SEPARADAMENTE pelo portal, DEPOIS da RPC ter sucesso, e faz só a
// limpeza de Storage (sem tocar auth.users/profiles) — best-effort,
// admin-gated, com trilha de auditoria crítica (mesma classe de
// `delete_user`).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown): NextRequest {
  return new Request('https://app.test/api/admin/users', {
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
  process.env.ADMIN_EMAILS = 'boss@x.com';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/admin/users — action cleanup_storage', () => {
  it('lista e remove os arquivos do usuário-alvo nos 3 buckets, e audita como crítico', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 }),
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ portal_access: true }]), { status: 200 }),
        );
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
      if (url.endsWith('/rest/v1/audit_log')) {
        return Promise.resolve(new Response('[]', { status: 201 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'cleanup_storage', userId: 'target-deleted-user' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cleaned).toBe('target-deleted-user');

    const listedBuckets = calls
      .filter((c) => c.url.includes('/storage/v1/object/list/'))
      .map((c) => c.url.split('/storage/v1/object/list/')[1]);
    expect(listedBuckets.sort()).toEqual(['art-refs', 'avatars', 'posts'].sort());

    const removeCall = calls.find((c) => c.url.includes('/storage/v1/object/remove/avatars'));
    const removedBody = JSON.parse(removeCall!.body!);
    expect(removedBody.prefixes).toEqual(['target-deleted-user/foto.webp']);

    // Audit trail crítico (mesma trilha exigida pra delete_user).
    const auditCall = calls.find((c) => c.url.endsWith('/rest/v1/audit_log'));
    expect(auditCall).toBeDefined();
    const auditRow = JSON.parse(auditCall!.body!);
    expect(auditRow.action).toBe('admin.user.cleanup_storage');
  });

  it('exige portal_access ativo do caller (mesmo guard das outras actions destrutivas)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'caller', email: 'boss@x.com' }), { status: 200 }),
        );
      }
      if (url.includes('/rpc/check_rate_limit')) {
        return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      }
      if (url.includes('select=portal_access')) {
        // Caller só está na allowlist, sem portal_access ativo.
        return Promise.resolve(new Response(JSON.stringify([{ portal_access: false }]), { status: 200 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(
      mkReq({ accessToken: 'good', action: 'cleanup_storage', userId: 'target' }),
    );
    expect(res.status).toBe(403);
  });
});
