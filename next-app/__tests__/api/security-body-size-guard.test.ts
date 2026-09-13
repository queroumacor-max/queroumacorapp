// __tests__/api/security-body-size-guard.test.ts — testes de
// `rejectOversizedBody` (auditoria de rate limiting/abuse 2026-09-13, item
// 51/52: request body size / JSON bomb).
//
// Motivo: vários handlers de IA (chat-ai, alice, senna, fe, generate-logo,
// ig-art, transcribe, area-from-photo, receipt-ocr) leem o corpo direto
// (`request.json()`/`request.formData()`) sem passar por `readBody` — sem
// NENHUM teto antes do parse. `rejectOversizedBody` é o pré-check barato
// (só olha `Content-Length`, não lê o corpo) que agora roda ANTES desses
// parses nos 9 handlers listados acima.

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { rejectOversizedBody, DEFAULT_MAX_BYTES } from '@/lib/api/security';

function mkReq(contentLength?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) headers['content-length'] = contentLength;
  return new Request('https://app.test/api/x', {
    method: 'POST',
    headers,
  }) as unknown as NextRequest;
}

describe('rejectOversizedBody', () => {
  it('libera (null) quando não há Content-Length', () => {
    expect(rejectOversizedBody(mkReq(undefined), 1024)).toBeNull();
  });

  it('libera (null) quando Content-Length está dentro do limite', () => {
    expect(rejectOversizedBody(mkReq('500'), 1024)).toBeNull();
  });

  it('libera no limite exato (boundary, não estritamente maior)', () => {
    expect(rejectOversizedBody(mkReq('1024'), 1024)).toBeNull();
  });

  it('rejeita com 413 quando Content-Length excede o limite', async () => {
    const res = rejectOversizedBody(mkReq('2048'), 1024);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(413);
    const body = await res!.json();
    expect(body.error).toMatch(/2048/);
    expect(body.error).toMatch(/1024/);
  });

  it('libera Content-Length não-numérico (header malformado não é motivo de bloqueio aqui)', () => {
    // Um header mentiroso/inválido não é catástrofe: quem lê o corpo de
    // verdade depois (JSON.parse, formData) ainda vai estourar em erro
    // próprio se o payload for lixo. Este helper só corta o caso claro
    // (número válido, maior que o teto).
    expect(rejectOversizedBody(mkReq('not-a-number'), 1024)).toBeNull();
  });

  it('usa DEFAULT_MAX_BYTES (10MB) quando nenhum limite é passado', () => {
    expect(rejectOversizedBody(mkReq(String(DEFAULT_MAX_BYTES + 1)))).not.toBeNull();
    expect(rejectOversizedBody(mkReq(String(DEFAULT_MAX_BYTES)))).toBeNull();
  });
});
