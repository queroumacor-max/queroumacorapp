// Teste adversarial — pendência fechada da auditoria de negócio 2026-09-16:
// `/api/moderate`/`/api/moderate-video` já passavam `feature:'moderate'`/
// `'moderate_video'` pra `gateAiUsage`, mas a RPC de baixo (`reserve_ai_usage`)
// soma TODO uso do mês do usuário sem filtrar por feature — moderação
// consumia o MESMO pool de 30/mês (free) que chat/legenda/etc. Publicar um
// post (que agora chama moderação, ver publicar-moderacao.test.tsx) gastaria
// cota que o usuário esperava usar em outra coisa.
//
// Este teste prova que `gateAiUsage`:
//   1. pra feature de moderação, chama `reserveModerationUsageViaRest` (pool
//      PRÓPRIO) — NUNCA `reserveAiUsageViaRest` (pool geral).
//   2. pra qualquer OUTRA feature, continua chamando `reserveAiUsageViaRest`
//      exatamente como antes — o comportamento pooled de chat/legenda/etc
//      não muda uma vírgula.
//   3. o teto passado pra moderação é o teto DEDICADO (não o do plano do
//      usuário) — prova que os pools são de fato independentes, não um
//      cálculo derivado do mesmo limite.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-public-test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';

const reserveAiUsageViaRestMock = vi.fn(
  async (_args: { userId: string; feature: string; limit: number }) => ({
    allowed: true,
    used: 1,
    limit: 30,
  }),
);
const reserveModerationUsageViaRestMock = vi.fn(
  async (_args: { userId: string; feature: string; limit: number }) => ({
    allowed: true,
    used: 1,
    limit: 1000,
  }),
);

vi.mock('../../lib/api/_services/_billing-helpers', () => ({
  isProActiveViaRest: async () => false,
  getPlanLimitViaRest: async () => 30, // free plan
  reserveAiUsageViaRest: (...args: unknown[]) =>
    reserveAiUsageViaRestMock(...(args as Parameters<typeof reserveAiUsageViaRestMock>)),
  reserveModerationUsageViaRest: (...args: unknown[]) =>
    reserveModerationUsageViaRestMock(...(args as Parameters<typeof reserveModerationUsageViaRestMock>)),
}));

beforeEach(() => {
  reserveAiUsageViaRestMock.mockClear();
  reserveModerationUsageViaRestMock.mockClear();
});

describe('gateAiUsage — moderação usa pool separado do pool geral de IA', () => {
  it("feature='moderate' chama reserveModerationUsageViaRest, NUNCA reserveAiUsageViaRest", async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'moderate' });
    expect(reserveModerationUsageViaRestMock).toHaveBeenCalledTimes(1);
    expect(reserveAiUsageViaRestMock).not.toHaveBeenCalled();
  });

  it("feature='moderate_video' chama reserveModerationUsageViaRest, NUNCA reserveAiUsageViaRest", async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'moderate_video' });
    expect(reserveModerationUsageViaRestMock).toHaveBeenCalledTimes(1);
    expect(reserveAiUsageViaRestMock).not.toHaveBeenCalled();
  });

  it("qualquer OUTRA feature (chat_ai, caption, ...) segue pelo pool geral, sem regressão", async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'chat_ai' });
    await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'caption' });
    expect(reserveAiUsageViaRestMock).toHaveBeenCalledTimes(2);
    expect(reserveModerationUsageViaRestMock).not.toHaveBeenCalled();
  });

  it('teto passado pra moderação é o teto DEDICADO, não o do plano do usuário (free=30)', async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'moderate' });
    const call = reserveModerationUsageViaRestMock.mock.calls[0][0] as { limit: number };
    expect(call.limit).not.toBe(30);
    expect(call.limit).toBeGreaterThan(30);
  });

  it('reserva de moderação negada (allowed:false) devolve 429, igual ao pool geral', async () => {
    reserveModerationUsageViaRestMock.mockResolvedValueOnce({ allowed: false, used: 1000, limit: 1000 });
    const { gateAiUsage } = await import('../../lib/api/security');
    const result = await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'moderate' });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
  });

  it('reserva de moderação aprovada devolve {allowed:true} direto, sem tocar no pool geral', async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    const result = await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'moderate' });
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { allowed: true }).allowed).toBe(true);
    expect(reserveAiUsageViaRestMock).not.toHaveBeenCalled();
  });
});
