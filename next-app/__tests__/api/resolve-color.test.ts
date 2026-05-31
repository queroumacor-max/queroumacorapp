// __tests__/api/resolve-color.test.ts — testes do route `/api/resolve-color`.

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

describe('POST /api/resolve-color', () => {
  it('returns 503 when no AI keys configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { POST } = await import('@/app/api/resolve-color/route');
    const res = await POST(
      mkJsonReq('/api/resolve-color', { items: [] }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/resolve-color/route');
    const res = await POST(
      mkJsonReq('/api/resolve-color', {
        items: [{ id: 'p1', name: 'Branco Neve' }],
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it('happy path: returns colors mapping', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        openAIChatResponse(JSON.stringify({ p1: '#f8f8f5', p2: '#ff0000' })),
    });
    const { POST } = await import('@/app/api/resolve-color/route');
    const res = await POST(
      mkJsonReq('/api/resolve-color', {
        items: [
          { id: 'p1', name: 'Branco Neve' },
          { id: 'p2', name: 'Vermelho' },
        ],
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.colors.p1).toBe('#f8f8f5');
  });

  it('returns empty colors object when items array empty', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/resolve-color/route');
    const res = await POST(
      mkJsonReq('/api/resolve-color', { items: [] }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.colors).toEqual({});
  });

  it('filters invalid hex from IA response', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        openAIChatResponse(JSON.stringify({ p1: 'invalid-hex', p2: '#abc123' })),
    });
    const { POST } = await import('@/app/api/resolve-color/route');
    const res = await POST(
      mkJsonReq('/api/resolve-color', {
        items: [
          { id: 'p1', name: 'A' },
          { id: 'p2', name: 'B' },
        ],
      }) as never
    );
    const body = await res.json();
    expect(body.colors.p1).toBeNull();
    expect(body.colors.p2).toBe('#abc123');
  });
});
