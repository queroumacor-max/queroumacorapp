// Teste grátis das IAs (2026-10-25): quem não é PRO ganha 1 uso por
// ferramenta (3 nos chats), contado no servidor pela RPC claim_ai_trial.
import { afterEach, describe, expect, it } from 'vitest';
import { gateProAI, ERR_PRO_ONLY } from '../../lib/api/security';
import { regraDeTeste, PRO_REQUIRED_CODE } from '../../lib/aiTrial';
import { installAuthMocks, type InstalledMocks } from './_helpers';

let mocks: InstalledMocks | null = null;
afterEach(() => {
  mocks?.restore();
  mocks = null;
});

function req(): Request {
  return new Request('https://queroumacor.com.br/api/caption', { method: 'POST', body: '{}' });
}

function trialResposta(allowed: boolean, used: number, limit: number) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/rest/v1/rpc/claim_ai_trial')) {
      const b = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ allowed, used, limit: b.p_limit ?? limit }), { status: 200 });
    }
    return new Response('not mocked', { status: 500 });
  };
}

describe('regras do teste', () => {
  it('1 uso por ferramenta, 3 nos chats, nada no diagnóstico de admin', () => {
    expect(regraDeTeste('caption')).toEqual({ key: 'caption', limit: 1, monthly: false });
    expect(regraDeTeste('chat-ai')?.limit).toBe(3);
    expect(regraDeTeste('fe')?.limit).toBe(3);
    expect(regraDeTeste('senna')?.limit).toBe(3);
    expect(regraDeTeste('ig-art-diag')).toBeNull();
    expect(regraDeTeste('')).toBeNull();
  });
});

describe('gateProAI com teste grátis', () => {
  it('PRO passa sem gastar teste', async () => {
    mocks = installAuthMocks({ pro: true, fetchRest: trialResposta(true, 1, 1) });
    const res = await gateProAI(req(), { accessToken: 't' }, { endpoint: 'caption' });
    expect(res).not.toBeInstanceOf(Response);
    expect((res as { trial?: unknown }).trial).toBeUndefined();
    expect(mocks.calls.some((c) => c.url.includes('claim_ai_trial'))).toBe(false);
  });

  it('não-PRO com teste disponível passa e diz que é teste', async () => {
    mocks = installAuthMocks({ pro: false, fetchRest: trialResposta(true, 1, 1) });
    const res = await gateProAI(req(), { accessToken: 't' }, { endpoint: 'caption' });
    expect(res).not.toBeInstanceOf(Response);
    expect((res as { trial?: unknown }).trial).toEqual({ used: 1, limit: 1 });
    const claim = mocks.calls.find((c) => c.url.includes('claim_ai_trial'));
    expect(JSON.parse(String(claim?.init?.body))).toMatchObject({ p_feature: 'caption', p_limit: 1 });
  });

  it('chat pede 3 usos', async () => {
    mocks = installAuthMocks({ pro: false, fetchRest: trialResposta(true, 2, 3) });
    await gateProAI(req(), { accessToken: 't' }, { endpoint: 'senna' });
    const claim = mocks.calls.find((c) => c.url.includes('claim_ai_trial'));
    expect(JSON.parse(String(claim?.init?.body))).toMatchObject({ p_feature: 'senna', p_limit: 3 });
  });

  it('teste esgotado → 403 com o código do paywall', async () => {
    mocks = installAuthMocks({ pro: false, fetchRest: trialResposta(false, 1, 1) });
    const res = (await gateProAI(req(), { accessToken: 't' }, { endpoint: 'caption' })) as Response;
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toMatchObject({ error: ERR_PRO_ONLY, code: PRO_REQUIRED_CODE });
  });

  it('RPC fora do ar → 403 (fechado: a rota já era só PRO)', async () => {
    mocks = installAuthMocks({ pro: false });
    const res = (await gateProAI(req(), { accessToken: 't' }, { endpoint: 'caption' })) as Response;
    expect(res.status).toBe(403);
  });

  it('rota sem teste (diagnóstico) nunca reserva', async () => {
    mocks = installAuthMocks({ pro: false, fetchRest: trialResposta(true, 1, 1) });
    const res = (await gateProAI(req(), { accessToken: 't' }, { endpoint: 'ig-art-diag' })) as Response;
    expect(res.status).toBe(403);
    expect(mocks.calls.some((c) => c.url.includes('claim_ai_trial'))).toBe(false);
  });
});
