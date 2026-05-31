// __tests__/api/middleware.test.ts — testes do middleware global de
// `x-request-id` (Backend#24). Cobre os 3 caminhos: gerar quando ausente,
// preservar quando vier do cliente/proxy, e setar header no response.

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';

function mkReq(headers: Record<string, string> = {}, path = '/api/health'): NextRequest {
  return new Request(`https://app.test${path}`, { headers }) as unknown as NextRequest;
}

describe('middleware (x-request-id)', () => {
  it('gera UUID novo quando request não tem x-request-id', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq());
    const id = res.headers.get('x-request-id');
    expect(id).toBeTruthy();
    // UUID v4 shape (8-4-4-4-12 hex). `crypto.randomUUID` v4-conforme.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('preserva x-request-id quando o cliente/proxy upstream já mandou', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq({ 'x-request-id': 'upstream-trace-abc-123' }));
    expect(res.headers.get('x-request-id')).toBe('upstream-trace-abc-123');
  });

  it('seta x-request-id no response (header propagado pro cliente)', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq({ 'x-request-id': 'fixed-id-xyz' }));
    // O response da NextResponse.next() vem com o header setado pelo middleware.
    expect(res.headers.get('x-request-id')).toBe('fixed-id-xyz');
    // Sanity: o config matcher do middleware aponta pra /api/:path*
    const { config } = await import('@/middleware');
    expect(config.matcher).toContain('/api/:path*');
  });

  it('trata x-request-id em branco como ausente (gera novo)', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq({ 'x-request-id': '   ' }));
    const id = res.headers.get('x-request-id');
    expect(id).toBeTruthy();
    expect(id).not.toBe('   ');
    expect(id).toMatch(/^[0-9a-f]{8}-/i);
  });
});
