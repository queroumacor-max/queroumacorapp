// audit-critical.test.ts — R-H5 do REMEDIATION_PLAN.
//
// `logAuditEvent({ critical: true })` deve dar `throw` quando o insert
// falhar (REST !ok, network error, config ausente, action vazia). Em
// `critical: false` ou omitido, mantém o comportamento fail-open
// original (`console.warn` + return undefined).
//
// Os tests existentes em `audit.test.ts` já cobrem o caminho fail-open;
// este arquivo blinda o caminho fail-closed pra LGPD/financeiro.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logAuditEvent } from '../../lib/api/audit';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE = 'service-test-key';
  // Silencia console.warn que o logger normalmente emite — não polui
  // o output dos testes mas mantém o spy disponível pra assertions.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('logAuditEvent critical:false (default)', () => {
  it('REST retornando 500 → não throws (fail-open)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 })
    ) as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'admin.something',
        critical: false,
      })
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('fetch network error → não throws (fail-open, sem critical)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    // Sem `critical` (undefined) — equivalente a false.
    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'admin.something',
      })
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('logAuditEvent critical:true', () => {
  it('REST retornando 500 → throws com status no message', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 })
    ) as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'lgpd.account_deletion',
        critical: true,
      })
    ).rejects.toThrowError(/audit critical insert failed: status=500/);
  });

  it('REST retornando 401 (RLS bloqueando) → throws', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('no permission', { status: 401 })
    ) as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'lgpd.me_export',
        critical: true,
      })
    ).rejects.toThrowError(/status=401/);
  });

  it('fetch network error → throws (propaga erro original)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'mp.subscription.authorized',
        critical: true,
      })
    ).rejects.toThrowError(/network down/);
  });

  it('REST retornando 201 (success) → não throws', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 201 })
    ) as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'lgpd.account_deletion',
        critical: true,
      })
    ).resolves.toBeUndefined();
  });

  it('action vazia → throws (mesma proteção pra critical)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: '',
        critical: true,
      })
    ).rejects.toThrowError(/empty action/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('SUPABASE_SERVICE_ROLE ausente → throws (config quebrada não é fail-open em critical)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'lgpd.account_deletion',
        critical: true,
      })
    ).rejects.toThrowError(/SUPABASE_SERVICE_ROLE/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('SUPABASE_URL ausente → throws', async () => {
    delete process.env.SUPABASE_URL;

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      logAuditEvent({
        actorId: 'u1',
        action: 'lgpd.account_deletion',
        critical: true,
      })
    ).rejects.toThrowError(/SUPABASE_URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
