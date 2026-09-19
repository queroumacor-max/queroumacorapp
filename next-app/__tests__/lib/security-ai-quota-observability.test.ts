// __tests__/lib/security-ai-quota-observability.test.ts — auditoria de
// observabilidade de segurança (2026-09-17). Antes desta rodada,
// "quem foi negado por cota de IA na última hora" não era respondível por
// NENHUMA fonte de dado dedicada (confirmado lendo `gateAiUsage` inteiro).
// Este teste trava que a negação (quota geral e pool de moderação) agora
// loga um evento estruturado.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-public-test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

vi.mock('../../lib/api/_services/_billing-helpers', () => ({
  isProActiveViaRest: async () => false,
  getPlanLimitViaRest: async () => 30,
  reserveAiUsageViaRest: async () => ({ allowed: false, used: 31, limit: 30 }),
  reserveModerationUsageViaRest: async () => ({ allowed: false, used: 1001 }),
}));

function lastSecurityWarn(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.find((c) => c[0] === '[security]');
  expect(call).toBeDefined();
  return JSON.parse(call![1] as string);
}

describe('gateAiUsage — observabilidade de quota negada', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loga security.ai.quota_exceeded (pool geral) na negação', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gateAiUsage } = await import('../../lib/api/security');
    const res = await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'chat_ai' });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(429);
    const record = lastSecurityWarn(warnSpy);
    expect(record.event).toBe('security.ai.quota_exceeded');
    expect(record.feature).toBe('chat_ai');
    expect(record.pool).toBe('general');
    warnSpy.mockRestore();
  });

  it('loga security.ai.quota_exceeded (pool moderação) na negação', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gateAiUsage } = await import('../../lib/api/security');
    const res = await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'moderate' });
    expect(res).toBeInstanceOf(Response);
    const record = lastSecurityWarn(warnSpy);
    expect(record.event).toBe('security.ai.quota_exceeded');
    expect(record.pool).toBe('moderation');
    warnSpy.mockRestore();
  });

  it('não loga nada quando a service key está ausente e cai fail-closed em produção (config, não abuso)', async () => {
    const OLD_ENV = { ...process.env };
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gateAiUsage } = await import('../../lib/api/security');
    const res = await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'chat_ai' });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(503);
    const call = errorSpy.mock.calls.find((c) => c[0] === '[security]');
    expect(call).toBeDefined();
    const record = JSON.parse(call![1] as string);
    expect(record.event).toBe('security.config.service_role_missing');
    expect(record.severity).toBe('critical');
    errorSpy.mockRestore();
    process.env = OLD_ENV;
  });
});
