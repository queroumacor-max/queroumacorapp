// Mensagem de ausência: reserva atômica no banco ANTES de enviar
// (2026-09-26). O teste de corrida em si é do SQL (INSERT … ON CONFLICT …
// WHERE); aqui fica o contrato do lado do código.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../lib/api/security', () => ({
  getServiceKey: () => 'svc-test-key',
  getSupabaseUrl: () => 'https://example.supabase.co',
}));

import { reservarAusencia } from '../../lib/api/_services/whatsapp-ai-runner';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function responder(res: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: async () => res.body,
    } as Response;
  }) as typeof fetch;
  return calls;
}

describe('reservarAusencia', () => {
  it('chama a RPC claim_wa_away e devolve reservada quando o banco diz true', async () => {
    const calls = responder({ body: true });
    await expect(reservarAusencia('5511999999999')).resolves.toBe('reservada');
    expect(calls[0]).toContain('/rest/v1/rpc/claim_wa_away');
  });

  it('banco diz false (outro isolate ganhou) → negada, não envia', async () => {
    responder({ body: false });
    await expect(reservarAusencia('5511999999999')).resolves.toBe('negada');
  });

  it('RPC ausente (404) → sem_rpc: cai no caminho antigo, não para a cortesia', async () => {
    responder({ ok: false, status: 404, body: { code: 'PGRST202' } });
    await expect(reservarAusencia('5511999999999')).resolves.toBe('sem_rpc');
  });

  it('erro de rede → sem_rpc', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(reservarAusencia('5511999999999')).resolves.toBe('sem_rpc');
  });
});
