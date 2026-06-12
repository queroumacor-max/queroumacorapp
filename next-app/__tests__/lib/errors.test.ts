// __tests__/lib/errors.test.ts — testes do helper R-H11 `errorResponse`.
//
// Garante que:
//   - prod NÃO vaza e.message no body (closed-by-default);
//   - dev/test inclui `dev_detail` pra DX;
//   - status code custom é respeitado;
//   - clientMessage default + custom funcionam;
//   - Sentry.captureException é chamado com tags;
//   - falha do Sentry NÃO bloqueia a resposta (resilience).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureException = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

/** Setter pra NODE_ENV (readonly em next/@types/node 22). */
function setNodeEnv(value: 'production' | 'development' | 'test'): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  captureException.mockReset();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('errorResponse — no-leak em produção', () => {
  it('em produção: response body NÃO contém hostname interno do error', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const e = new Error(
      'pg_connection failed: supabase.internal.private:5432 timeout',
    );
    const res = errorResponse(e);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('supabase.internal');
    expect(JSON.stringify(body)).not.toContain('5432');
    expect(body.error).toBe('erro interno');
    // dev_detail NÃO aparece em prod
    expect(body.dev_detail).toBeUndefined();
  });

  it('em produção: erro string (não-Error) também não vaza', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse('SQL error at /db/internal/path/secret');
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('internal');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body.error).toBe('erro interno');
  });
});

describe('errorResponse — dev/test inclui dev_detail', () => {
  it('em development: response body inclui dev_detail com e.message', async () => {
    setNodeEnv('development');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse(new Error('test msg'));
    const body = await res.json();
    expect(body.error).toBe('erro interno');
    expect(body.dev_detail).toBe('test msg');
  });

  it('em test: response body inclui dev_detail (mesma branch de dev)', async () => {
    setNodeEnv('test');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse(new Error('detalhe pra DX'));
    const body = await res.json();
    expect(body.dev_detail).toBe('detalhe pra DX');
  });

  it('em dev com erro string (não-Error): SEM dev_detail (só Error tem message)', async () => {
    setNodeEnv('development');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse('apenas uma string');
    const body = await res.json();
    expect(body.error).toBe('erro interno');
    expect(body.dev_detail).toBeUndefined();
  });
});

describe('errorResponse — opts customizadas', () => {
  it('status custom: 404 é respeitado', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse(new Error('not found'), { status: 404 });
    expect(res.status).toBe(404);
  });

  it('status custom: 503 é respeitado', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse(new Error('unavailable'), { status: 503 });
    expect(res.status).toBe(503);
  });

  it('clientMessage custom: substitui o default "erro interno"', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse(new Error('xx'), {
      clientMessage: 'não encontrado',
    });
    const body = await res.json();
    expect(body.error).toBe('não encontrado');
  });

  it('default sem opts: status 500 e clientMessage "erro interno"', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const res = errorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('erro interno');
  });
});

describe('errorResponse — Sentry capture', () => {
  it('chama Sentry.captureException com a exception', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const e = new Error('boom');
    errorResponse(e);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(e, { tags: undefined });
  });

  it('passa tags ao Sentry quando fornecidas', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    const e = new Error('boom');
    errorResponse(e, { tags: { route: 'ig-art', kind: 'handler' } });
    expect(captureException).toHaveBeenCalledWith(e, {
      tags: { route: 'ig-art', kind: 'handler' },
    });
  });

  it('captura erro mesmo quando é string (não-Error)', async () => {
    setNodeEnv('production');
    const { errorResponse } = await import('@/lib/api/errors');
    errorResponse('plain string error');
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith('plain string error', {
      tags: undefined,
    });
  });
});

describe('errorResponse — resilience a falha do Sentry', () => {
  it('Sentry.captureException throw: NÃO impede a resposta', async () => {
    setNodeEnv('production');
    captureException.mockImplementationOnce(() => {
      throw new Error('sentry init failure');
    });
    const { errorResponse } = await import('@/lib/api/errors');
    // Não deve lançar
    const res = errorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('erro interno');
  });
});
