// Teste adversarial (item #150 do pedido da auditoria de negócio 2026-09-16:
// "10 requests concorrentes com 1 crédito → no máximo 1 sucesso").
//
// Antes do fix, `gateAiUsage` fazia SELECT (uso do mês) → compara com
// limite → só DEPOIS da chamada de IA gravava o uso via `recordAiUsage`.
// Esse teste não pode reproduzir a corrida de verdade contra Postgres (sem
// banco neste ambiente), mas prova a parte que O CÓDIGO TypeScript é
// responsável por garantir: `gateAiUsage` não faz mais NENHUM check
// independente — ele delega o check+reserva inteiro pra UMA chamada de
// `reserveAiUsageViaRest` (a RPC atômica) e confia cegamente no resultado
// dela. Simulamos a RPC com um contador em memória que se comporta como o
// `INSERT...ON CONFLICT...RETURNING` do Postgres (atômico por construção,
// já que é síncrono dentro do event loop) — o que este teste garante é que
// NADA em `gateAiUsage` reabre a janela entre "ler quanto falta" e "decidir
// permitir", que era exatamente o bug.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-public-test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';

const LIMIT = 1;
let reservedCount = 0;

const reserveAiUsageViaRestMock = vi.fn(
  async (_args: { userId: string; feature: string; limit: number }) => {
    // "Atômico": um único incremento síncrono por chamada, sem await no
    // meio do check — é isso que a RPC real garante via advisory lock; aqui
    // é garantido pelo single-thread do JS. O que este teste verifica não é
    // ISSO (a atomicidade do Postgres já está coberta em
    // businessLogicSecurityAudit.test.ts), e sim que `gateAiUsage` chama
    // isto e SÓ isto — sem recontar por fora.
    if (reservedCount < LIMIT) {
      reservedCount += 1;
      return { allowed: true, used: reservedCount, limit: LIMIT };
    }
    return { allowed: false, used: reservedCount, limit: LIMIT };
  },
);

vi.mock('../../lib/api/_services/_billing-helpers', () => ({
  isProActiveViaRest: async () => false,
  getPlanLimitViaRest: async () => LIMIT,
  reserveAiUsageViaRest: (...args: Parameters<typeof reserveAiUsageViaRestMock>) =>
    reserveAiUsageViaRestMock(...args),
}));

beforeEach(() => {
  reservedCount = 0;
  reserveAiUsageViaRestMock.mockClear();
});

describe('gateAiUsage — concorrência com 1 crédito de cota (item #150)', () => {
  it('no máximo 1 de 10 requisições concorrentes é permitida quando o limite é 1', async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        gateAiUsage({ userId: 'user-race', email: 'x@y.com', feature: 'chat_ai' }),
      ),
    );
    const allowed = results.filter((r) => !(r instanceof Response));
    const denied = results.filter((r) => r instanceof Response);
    expect(allowed.length).toBe(1);
    expect(denied.length).toBe(9);
    for (const d of denied) {
      expect((d as Response).status).toBe(429);
    }
  });

  it('gateAiUsage delega pra reserveAiUsageViaRest — não faz nenhum check próprio de "used >= limit"', async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    await gateAiUsage({ userId: 'u1', email: 'x@y.com', feature: 'chat_ai' });
    expect(reserveAiUsageViaRestMock).toHaveBeenCalledTimes(1);
    expect(reserveAiUsageViaRestMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', feature: 'chat_ai', limit: LIMIT }),
    );
  });

  it('quota liberada (allowed:true) devolve {allowed:true} direto do resultado da reserva, sem round-trip extra', async () => {
    const { gateAiUsage } = await import('../../lib/api/security');
    const result = await gateAiUsage({ userId: 'u2', email: 'x@y.com', feature: 'chat_ai' });
    expect(result).not.toBeInstanceOf(Response);
    const obj = result as { allowed: true; used: number; limit: number };
    expect(obj.allowed).toBe(true);
    expect(obj.used).toBe(1);
    expect(obj.limit).toBe(LIMIT);
  });
});
