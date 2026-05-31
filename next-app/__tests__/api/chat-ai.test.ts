// __tests__/api/chat-ai.test.ts — testes do route `/api/chat-ai`.
// Cobre: missing API key → 503, PRO gate, happy path OpenAI, provider erro
// → 502, mensagem vazia → 400.

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

describe('POST /api/chat-ai', () => {
  it('returns 503 when neither API key configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(mkJsonReq('/api/chat-ai', { message: 'oi' }) as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/IA não configurada/);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(mkJsonReq('/api/chat-ai', { message: 'oi' }) as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/PRO/);
  });

  it('happy path: returns reply from OpenAI', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => openAIChatResponse('Opa, sou o Seu Zé!'),
    });
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(
      mkJsonReq('/api/chat-ai', { message: 'oi' }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe('Opa, sou o Seu Zé!');
  });

  it('returns 502 when OpenAI fails and no Gemini fallback', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => new Response('boom', { status: 500 }),
    });
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(
      mkJsonReq('/api/chat-ai', { message: 'oi' }) as never
    );
    expect(res.status).toBe(502);
  });

  it('returns 400 when message is empty', async () => {
    mocks = installAuthMocks({
      fetchRest: async () => openAIChatResponse('shouldnt-be-called'),
    });
    const { POST } = await import('@/app/api/chat-ai/route');
    const res = await POST(mkJsonReq('/api/chat-ai', { message: '   ' }) as never);
    expect(res.status).toBe(400);
  });
});
