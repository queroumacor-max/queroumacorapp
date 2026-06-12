// __tests__/api/chat-ai-validation.test.ts — R-H10 (validação Zod).
// Cobre rejeição de body inválido em `/api/chat-ai` antes do auth/PRO.

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
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

describe('POST /api/chat-ai — Zod validation (R-H10)', () => {
  it('rejects message with wrong type (number) → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(
      mkJsonReq('/api/chat-ai', { message: 12345 }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects message too long (> 10_000 chars) → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/chat-ai/route');
    const huge = 'x'.repeat(10_001);
    const res = await POST(
      mkJsonReq('/api/chat-ai', { message: huge }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects history with invalid role → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(
      mkJsonReq('/api/chat-ai', {
        message: 'oi',
        history: [{ role: 'hacker', content: 'pwned' }],
      }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects history with > 20 messages → 400', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/chat-ai/route');
    const history = Array.from({ length: 21 }, () => ({
      role: 'user',
      content: 'spam',
    }));
    const res = await POST(
      mkJsonReq('/api/chat-ai', { message: 'oi', history }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('accepts valid body and flows to handler → 200', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => openAIChatResponse('Opa!'),
    });
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(
      mkJsonReq('/api/chat-ai', {
        message: 'oi',
        history: [{ role: 'user', content: 'opa' }],
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe('Opa!');
  });
});
