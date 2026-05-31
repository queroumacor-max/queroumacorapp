// Tests do port lib/errors.ts.
// Cobre a hierarquia (status/code/details/cause), a serialização pra JSON
// e os helpers isAppError/toAppError.

import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthorizationError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ConflictError,
  ConfigError,
  NetworkError,
  isAppError,
  toAppError,
  errorToJson,
} from '../lib/errors';

describe('AppError — defaults', () => {
  it('status default 500, code "app_error"', () => {
    const e = new AppError();
    expect(e.status).toBe(500);
    expect(e.code).toBe('app_error');
    expect(e.name).toBe('AppError');
    expect(e.details).toBeNull();
  });
  it('aceita override de status/code/details', () => {
    const e = new AppError('msg', { status: 418, code: 'teapot', details: { x: 1 } });
    expect(e.status).toBe(418);
    expect(e.code).toBe('teapot');
    expect(e.details).toEqual({ x: 1 });
  });
});

describe('Subclasses — status/code esperados', () => {
  const cases: ReadonlyArray<[() => AppError, number, string, string]> = [
    [() => new ValidationError(), 400, 'validation_error', 'ValidationError'],
    [() => new AuthorizationError(), 403, 'authorization_error', 'AuthorizationError'],
    [() => new AuthenticationError(), 401, 'authentication_error', 'AuthenticationError'],
    [() => new NotFoundError('Post'), 404, 'not_found', 'NotFoundError'],
    [() => new RateLimitError(30), 429, 'rate_limit', 'RateLimitError'],
    [() => new ConflictError(), 409, 'conflict', 'ConflictError'],
    [() => new ConfigError(), 500, 'config_error', 'ConfigError'],
    [() => new NetworkError(), 502, 'network_error', 'NetworkError'],
  ];
  for (const [make, status, code, name] of cases) {
    it(`${name} → status ${status}, code ${code}`, () => {
      const e = make();
      expect(e.status).toBe(status);
      expect(e.code).toBe(code);
      expect(e.name).toBe(name);
    });
  }
  it('NotFoundError põe o recurso em details', () => {
    const e = new NotFoundError('Post');
    expect((e.details as { resource: string }).resource).toBe('Post');
    expect(e.message).toMatch(/Post não encontrado/);
  });
  it('RateLimitError põe retryAfter em details', () => {
    const e = new RateLimitError(60);
    expect((e.details as { retryAfter: number }).retryAfter).toBe(60);
  });
});

describe('isAppError / toAppError', () => {
  it('isAppError', () => {
    expect(isAppError(new AppError())).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('foo')).toBe(false);
  });
  it('toAppError preserva AppError', () => {
    const e = new AppError('x');
    expect(toAppError(e)).toBe(e);
  });
  it('toAppError converte Error em AppError', () => {
    const e = toAppError(new Error('boom'));
    expect(isAppError(e)).toBe(true);
    expect(e.message).toBe('boom');
  });
  it('toAppError converte string em AppError', () => {
    expect(toAppError('bug').message).toBe('bug');
  });
});

describe('errorToJson', () => {
  it('serializa AppError sem incluir stack/cause', () => {
    const j = errorToJson(new ValidationError('msg', { field: 'email' }));
    expect(j).toEqual({
      error: 'msg',
      code: 'validation_error',
      status: 400,
      details: { field: 'email' },
    });
  });
  it('não inclui details quando null', () => {
    const j = errorToJson(new AppError('x'));
    expect(j).toEqual({ error: 'x', code: 'app_error', status: 500 });
    expect('details' in j).toBe(false);
  });
});
