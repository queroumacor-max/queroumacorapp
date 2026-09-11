// authRateCheck.test.ts — pré-checagem de rate limit dos formulários de auth:
// 429 bloqueia; qualquer outra coisa (200, 5xx, rede fora) libera.
import { describe, expect, it, vi } from 'vitest';
import { mensagemDeLimite, preCheckAuthRate } from '../../lib/services/authRateCheck';

describe('preCheckAuthRate', () => {
  it('429 → bloqueado com retry_after do servidor', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: 'limite', retry_after: 42 }), { status: 429 }),
    );
    const v = await preCheckAuthRate('login', f as unknown as typeof fetch);
    expect(v).toEqual({ blocked: true, retryAfter: 42 });
    expect(mensagemDeLimite(v)).toContain('42s');
    const init = f.mock.calls[0][1]!;
    expect(JSON.parse(String(init.body))).toEqual({ action: 'login' });
  });
  it('200 → liberado', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ allowed: true }), { status: 200 }));
    expect(await preCheckAuthRate('signup', f as unknown as typeof fetch)).toEqual({ blocked: false });
  });
  it('rede fora / 5xx → FAIL-OPEN (um blip nunca tranca o login)', async () => {
    const morto = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await preCheckAuthRate('reset', morto as unknown as typeof fetch)).toEqual({ blocked: false });
    const cinco = vi.fn(async () => new Response('x', { status: 503 }));
    expect(await preCheckAuthRate('reset', cinco as unknown as typeof fetch)).toEqual({ blocked: false });
  });
});
