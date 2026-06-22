// __tests__/api/security-ratelimit.test.ts — testes dos helpers de rate
// limit global: `getClientIp` (extração de IP dos headers de borda) e
// `enforceRateLimit` (gate por IP/usuário reaproveitando checkRateLimit).
//
// checkRateLimit é FAIL-OPEN sem SUPABASE_SERVICE_ROLE_KEY, então sem a env
// o enforce sempre libera (retorna null). Pra testar o caminho 429 a gente
// mocka o fetch da RPC `check_rate_limit`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { getClientIp, enforceRateLimit } from '@/lib/api/security';

function mkReq(headers: Record<string, string> = {}): NextRequest {
  return new Request('https://app.test/api/x', {
    method: 'GET',
    headers,
  }) as unknown as NextRequest;
}

describe('getClientIp', () => {
  it('prioriza CF-Connecting-IP', () => {
    const req = mkReq({
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '5.6.7.8, 9.9.9.9',
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('cai pro primeiro IP de X-Forwarded-For', () => {
    const req = mkReq({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('cai pro X-Real-IP', () => {
    const req = mkReq({ 'x-real-ip': '10.0.0.1' });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('retorna "unknown" sem nenhum header de IP', () => {
    expect(getClientIp(mkReq())).toBe('unknown');
  });
});

describe('enforceRateLimit', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('FAIL-OPEN (retorna null) sem service key — não bloqueia', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await enforceRateLimit(mkReq({ 'cf-connecting-ip': '1.1.1.1' }), {
      endpoint: 'test',
      limit: 1,
    });
    expect(res).toBeNull();
  });

  it('retorna 429 quando a RPC diz allowed=false', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    process.env.SUPABASE_URL = 'https://supa.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ allowed: false, count: 61, limit: 60, retry_after_seconds: 42 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const res = await enforceRateLimit(mkReq({ 'cf-connecting-ip': '2.2.2.2' }), {
      endpoint: 'test',
      limit: 60,
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('retry-after')).toBe('42');
  });

  it('libera (null) quando a RPC diz allowed=true', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    process.env.SUPABASE_URL = 'https://supa.test';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ allowed: true, count: 1, limit: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await enforceRateLimit(mkReq({ 'cf-connecting-ip': '3.3.3.3' }), {
      endpoint: 'test',
      limit: 60,
    });
    expect(res).toBeNull();
    // Confirma que a chave usada foi o IP (sem userId).
    const callBody = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(callBody.p_user_id).toBe('ip:3.3.3.3');
  });

  it('usa a chave de usuário quando userId é passado', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    process.env.SUPABASE_URL = 'https://supa.test';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await enforceRateLimit(mkReq({ 'cf-connecting-ip': '4.4.4.4' }), {
      endpoint: 'test',
      userId: 'user-123',
    });
    const callBody = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(callBody.p_user_id).toBe('u:user-123');
  });
});
