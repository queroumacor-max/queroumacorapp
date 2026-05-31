// __tests__/api/agenda-order.test.ts — testes do route `/api/agenda-order`.

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

describe('POST /api/agenda-order', () => {
  it('returns 503 when no AI keys configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { POST } = await import('@/app/api/agenda-order/route');
    const res = await POST(mkJsonReq('/api/agenda-order', { jobs: [] }) as never);
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/agenda-order/route');
    const res = await POST(
      mkJsonReq('/api/agenda-order', {
        jobs: [
          { id: '1', address: 'A' },
          { id: '2', address: 'B' },
        ],
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when less than 2 jobs', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/agenda-order/route');
    const res = await POST(
      mkJsonReq('/api/agenda-order', { jobs: [{ id: '1', address: 'A' }] }) as never
    );
    expect(res.status).toBe(400);
  });

  it('happy path: returns ordered_ids + notes', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        openAIChatResponse(
          JSON.stringify({ ordered_ids: ['2', '1'], notes: 'começa pelo bairro 2' })
        ),
    });
    const { POST } = await import('@/app/api/agenda-order/route');
    const res = await POST(
      mkJsonReq('/api/agenda-order', {
        jobs: [
          { id: '1', address: 'Zona Norte' },
          { id: '2', address: 'Centro' },
        ],
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ordered_ids).toEqual(['2', '1']);
    expect(body.notes).toMatch(/bairro/);
  });

  it('completes missing ids when IA omits some', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        openAIChatResponse(
          JSON.stringify({ ordered_ids: ['1'], notes: '' })
        ),
    });
    const { POST } = await import('@/app/api/agenda-order/route');
    const res = await POST(
      mkJsonReq('/api/agenda-order', {
        jobs: [
          { id: '1', address: 'A' },
          { id: '2', address: 'B' },
        ],
      }) as never
    );
    const body = await res.json();
    // IDs faltantes são apendados.
    expect(body.ordered_ids).toContain('1');
    expect(body.ordered_ids).toContain('2');
  });
});
