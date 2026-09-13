// __tests__/api/auth-rate-check.test.ts — testes do route handler.
// Cobre: action default=login, action whitelisted (signup/reset/unknown),
// rate-limit allowed (fail-open sem service key) e blocked (429).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mkReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://app.test/api/auth-rate-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /api/auth-rate-check', () => {
  it('returns allowed=true with action=login (default), skipped without service key', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    const { POST } = await import('@/app/api/auth-rate-check/route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.action).toBe('login');
    expect(body.limit).toBe(10);
    expect(body.skipped).toBe(true);
  });

  it('falls back to login when action is unknown, returns proper limit for signup', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { POST } = await import('@/app/api/auth-rate-check/route');
    const r1 = await POST(mkReq({ action: 'pwnyou' }));
    expect((await r1.json()).action).toBe('login');
    const r2 = await POST(mkReq({ action: 'signup' }));
    const b2 = await r2.json();
    expect(b2.action).toBe('signup');
    expect(b2.limit).toBe(5);
  });

  it('returns 429 with retry-after when RPC says blocked', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ allowed: false, count: 11, limit: 10, retry_after_seconds: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { POST } = await import('@/app/api/auth-rate-check/route');
    const res = await POST(mkReq({ action: 'login' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
  });

  // Auditoria de rate limiting/abuse 2026-09-13 — achado CRÍTICO: até
  // 2026-09-13, `rate_limits.user_id` e `check_rate_limit(p_user_id uuid,
  // ...)` eram UUID no banco, mas a chave que este endpoint manda é uma
  // STRING composta ("ip:<ip>:<action>") — nunca um UUID. O PostgREST
  // recusava o cast (22P02 → HTTP 400) e `checkRateLimit` trata QUALQUER
  // `!res.ok` como "serviço indisponível" → fail-open. Ou seja: o rate
  // limit de login/signup/reset por IP nunca chegou a rodar de verdade.
  // Corrigido em `migrations/2026-09-13-security-audit-hardening.sql`
  // (coluna e parâmetro viram `text`). Os dois testes abaixo travam: (1)
  // a chave que SAI daqui é sempre não-UUID (por que o fix de banco era
  // necessário) e (2) o comportamento de fail-open em erro do backend
  // continua correto e intencional — o que muda é que o backend REAL
  // não vai mais devolver esse erro pra essa chave.
  it('a chave mandada pra checkRateLimit é sempre "ip:<ip>:<action>" — nunca um UUID', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ allowed: true, count: 1, limit: 10 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    globalThis.fetch = spy;
    const { POST } = await import('@/app/api/auth-rate-check/route');
    await POST(mkReq({ action: 'login' }, { 'cf-connecting-ip': '203.0.113.5' }));
    const sentBody = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(sentBody.p_user_id).toBe('ip:203.0.113.5:login');
    // Prova que NÃO é um UUID — é exatamente essa string que a coluna
    // `uuid` da versão antiga do banco recusava.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(UUID_RE.test(sentBody.p_user_id)).toBe(false);
  });

  it('backend rejeitando a chave (400, como o PostgREST fazia com a coluna uuid) faz fail-open — comportamento correto do JS, o bug era no schema', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: '22P02',
          message: 'invalid input syntax for type uuid: "ip:203.0.113.5:login"',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    );
    const { POST } = await import('@/app/api/auth-rate-check/route');
    const res = await POST(mkReq({ action: 'login' }, { 'cf-connecting-ip': '203.0.113.5' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // fail-open é o comportamento CERTO pra erro genérico de backend
    // (blip de rede, timeout, RPC fora do ar) — o problema nunca foi essa
    // regra, foi o schema que fazia ela disparar SEMPRE.
    expect(body.allowed).toBe(true);
    expect(body.skipped).toBe(true);
  });

  it('OPTIONS returns 204', async () => {
    const { OPTIONS } = await import('@/app/api/auth-rate-check/route');
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});
