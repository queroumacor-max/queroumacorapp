// Testes do gate de autenticação de POST /api/whatsapp-evo/webhook.
//
// Auditoria de segurança Cloudflare (2026-09-13): a comparação do token da
// URL usava `!==` (string comparison do JS), que sai no primeiro byte
// diferente — um atacante medindo latência de muitas tentativas pode
// inferir o `EVOLUTION_WEBHOOK_TOKEN` byte a byte. Trocado por `safeEqual`
// (tempo constante), mesma regra já usada no webhook da Meta e no MP.
//
// Este teste não mede timing (isso é frágil em CI); trava o CONTRATO:
// token certo entra, token errado/vazio/de outro tamanho é 401, e sem a
// env configurada a rota falha fechado (503), nunca processa sem
// autenticação.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TOKEN = 'segredo-evolution-para-teste-1234567890';

vi.mock('@/lib/api/_services/whatsapp-ai-runner', () => ({
  maybeAutoReply: vi.fn(async () => ({ acted: false, why: 'teste' })),
}));
vi.mock('@/lib/api/_services/whatsapp-media', () => ({
  processarMidia: vi.fn(async () => ({ mediaUrl: null, mediaMime: null, transcript: null })),
}));
vi.mock('@/lib/api/_services/whatsapp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/_services/whatsapp')>(
    '@/lib/api/_services/whatsapp'
  );
  return { ...actual, persistWhatsAppMessage: vi.fn(async () => true) };
});

function postWithToken(token: string | null) {
  // O handler usa `request.nextUrl.searchParams`, específico do NextRequest
  // — um `Request` puro não tem essa propriedade. Mesmo padrão de
  // __tests__/api/cidades.test.ts.
  const { NextRequest } = require('next/server');
  const url = new URL('https://queroumacor.com.br/api/whatsapp-evo/webhook');
  if (token !== null) url.searchParams.set('token', token);
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/whatsapp-evo/webhook — autenticação por token de URL', () => {
  const originalEnv = process.env.EVOLUTION_WEBHOOK_TOKEN;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.EVOLUTION_WEBHOOK_TOKEN;
    else process.env.EVOLUTION_WEBHOOK_TOKEN = originalEnv;
  });

  it('falha fechado (503) quando EVOLUTION_WEBHOOK_TOKEN não está configurado', async () => {
    delete process.env.EVOLUTION_WEBHOOK_TOKEN;
    const { POST } = await import('@/app/api/whatsapp-evo/webhook/route');
    const res = await POST(postWithToken(TOKEN) as never);
    expect(res.status).toBe(503);
  });

  it('rejeita (401) token ausente, vazio, errado ou de tamanho diferente', async () => {
    process.env.EVOLUTION_WEBHOOK_TOKEN = TOKEN;
    const { POST } = await import('@/app/api/whatsapp-evo/webhook/route');

    for (const bad of [null, '', 'errado', TOKEN.slice(0, -1), TOKEN + 'x']) {
      const res = await POST(postWithToken(bad) as never);
      expect(res.status).toBe(401);
    }
  });

  it('aceita (200) o token correto', async () => {
    process.env.EVOLUTION_WEBHOOK_TOKEN = TOKEN;
    const { POST } = await import('@/app/api/whatsapp-evo/webhook/route');
    const res = await POST(postWithToken(TOKEN) as never);
    expect(res.status).toBe(200);
  });
});
