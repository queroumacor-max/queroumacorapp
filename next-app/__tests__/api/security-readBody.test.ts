// __tests__/api/security-readBody.test.ts — testes do helper `readBody`
// (Backend#26, max payload guards). Cobre parse JSON válido, JSON inválido,
// overflow por content-length, overflow pós-leitura (chunked), multipart.

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { readBody, ServiceError, DEFAULT_MAX_BYTES } from '@/lib/api/security';

function mkJsonReq(body: string, contentLength?: number): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  return new Request('https://app.test/api/x', {
    method: 'POST',
    headers,
    body,
  }) as unknown as NextRequest;
}

function mkFormReq(form: FormData): NextRequest {
  return new Request('https://app.test/api/x', {
    method: 'POST',
    body: form,
  }) as unknown as NextRequest;
}

describe('readBody', () => {
  it('parses JSON body válido', async () => {
    const req = mkJsonReq(JSON.stringify({ hello: 'world', n: 42 }));
    const result = (await readBody(req)) as { hello: string; n: number };
    expect(result).toEqual({ hello: 'world', n: 42 });
  });

  it('throws ServiceError(400) com JSON inválido', async () => {
    // Cada Request só pode ter o body lido 1x — então criamos req fresco aqui.
    const req = mkJsonReq('{ not valid json: ');
    let caught: unknown;
    try {
      await readBody(req);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceError);
    expect((caught as ServiceError).status).toBe(400);
    expect((caught as ServiceError).message).toMatch(/Invalid JSON/i);
  });

  it('throws 413 quando content-length declarado > maxBytes (cheap path)', async () => {
    // content-length 5MB com maxBytes 1MB → 413 imediato (sem ler body).
    const req = mkJsonReq('{}', 5 * 1024 * 1024);
    let caught: unknown;
    try {
      await readBody(req, { maxBytes: 1024 * 1024 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceError);
    expect((caught as ServiceError).status).toBe(413);
    expect((caught as ServiceError).message).toMatch(/Payload too large/i);
  });

  it('throws 413 quando byteLength real > maxBytes (forçar pós-leitura via content-length=0)', async () => {
    // Forçamos content-length=0 pra bypass do cheap path; body real tem 2KB de
    // payload — a verificação pós-leitura (byteLength real) deve pegar e 413.
    // (Cenário equivalente ao chunked encoding sem content-length confiável.)
    const big = 'x'.repeat(2048);
    const req = mkJsonReq(JSON.stringify({ blob: big }), 0);
    let caught: unknown;
    try {
      await readBody(req, { maxBytes: 1024 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceError);
    expect((caught as ServiceError).status).toBe(413);
    expect((caught as ServiceError).message).toMatch(/after read/i);
  });

  it('retorna FormData quando type=form', async () => {
    const form = new FormData();
    form.append('a', '1');
    form.append('b', 'two');
    const req = mkFormReq(form);
    const result = (await readBody(req, { type: 'form' })) as FormData;
    expect(result).toBeInstanceOf(FormData);
    expect(result.get('a')).toBe('1');
    expect(result.get('b')).toBe('two');
  });

  it('aceita request sem content-length header (parsa o body normalmente)', async () => {
    // Constrói Request sem setar content-length explicitamente — fetch/undici
    // pode infer um, mas validamos só que readBody não quebra.
    const req = new Request('https://app.test/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    }) as unknown as NextRequest;
    const result = (await readBody(req)) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it('DEFAULT_MAX_BYTES é 10MB', () => {
    expect(DEFAULT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
