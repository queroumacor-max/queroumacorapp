// __tests__/api/crm-draft.test.ts — testes do route `/api/crm-draft`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installAuthMocks,
  mkJsonReq,
  openAIChatResponse,
  type InstalledMocks,
} from './_helpers';

let mocks: InstalledMocks | null = null;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

describe('POST /api/crm-draft', () => {
  it('returns 503 when no AI keys configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { POST } = await import('@/app/api/crm-draft/route');
    const res = await POST(
      mkJsonReq('/api/crm-draft', { clientName: 'João' }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/crm-draft/route');
    const res = await POST(
      mkJsonReq('/api/crm-draft', { clientName: 'João' }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns draft message', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        openAIChatResponse('Olá João, faz tempo! Bora repintar?'),
    });
    const { POST } = await import('@/app/api/crm-draft/route');
    const res = await POST(
      mkJsonReq('/api/crm-draft', {
        clientName: 'João',
        lastService: 'pintura sala',
        monthsSince: 8,
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toContain('João');
  });

  it('happy path with no inputs still works (generic draft)', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => openAIChatResponse('Olá, faz tempo!'),
    });
    const { POST } = await import('@/app/api/crm-draft/route');
    const res = await POST(mkJsonReq('/api/crm-draft', {}) as never);
    expect(res.status).toBe(200);
  });

  it('returns 502 when AI returns empty', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => openAIChatResponse(''),
    });
    const { POST } = await import('@/app/api/crm-draft/route');
    const res = await POST(
      mkJsonReq('/api/crm-draft', { clientName: 'X' }) as never
    );
    expect(res.status).toBe(502);
  });
});
