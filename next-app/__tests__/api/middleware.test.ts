// __tests__/api/middleware.test.ts — testes do middleware global de
// `x-request-id` (Backend#24). Cobre os 3 caminhos: gerar quando ausente,
// preservar quando vier do cliente/proxy, e setar header no response.
//
// Também trava a mitigação de CVE-2025-66478/CVE-2025-55182 (auditoria de
// segurança mobile, 2026-09-13): requisição com o header `Next-Action` tem
// que ser barrada com 404 ANTES de qualquer outro processamento — este app
// não declara nenhuma Server Action, então esse header nunca é tráfego
// legítimo (ver middleware.ts para o raciocínio completo).

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
    // Sanity: o matcher cobre rotas de página (não só /api), que é onde uma
    // Server Action forjada seria invocada — exclui só assets estáticos.
    const { config } = await import('@/middleware');
    expect(config.matcher.join(',')).not.toContain('/api/:path*');
    expect(config.matcher.join(',')).toMatch(/_next\/static/);
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

describe('middleware — bloqueio do vetor CVE-2025-66478/CVE-2025-55182 (Next-Action)', () => {
  it('requisição com header Next-Action é barrada com 404, sem seguir adiante', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq({ 'next-action': '00112233445566778899aabbccddeeff0011223' }, '/feed'));
    expect(res.status).toBe(404);
    // Não deve nem chegar a gerar/propagar x-request-id — a resposta é
    // encerrada antes de qualquer outro processamento.
    expect(res.headers.get('x-request-id')).toBeNull();
  });

  it('barra em QUALQUER rota de página, não só /api — Actions são invocadas na própria URL', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq({ 'next-action': 'x' }, '/perfil/alguem'));
    expect(res.status).toBe(404);
  });

  it('nome do header é case-insensitive (Headers nativo já normaliza)', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq({ 'Next-Action': 'x' }, '/'));
    expect(res.status).toBe(404);
  });

  it('requisição SEM o header segue normalmente (nada quebra pra tráfego legítimo)', async () => {
    const { middleware } = await import('@/middleware');
    const res = middleware(mkReq({}, '/feed'));
    expect(res.status).not.toBe(404);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});
