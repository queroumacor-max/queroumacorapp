import { describe, it, expect } from 'vitest';
import { getToken } from '../functions/api/_security.js';

describe('getToken', () => {
  it('extrai token do body.accessToken', () => {
    const req = { headers: new Map() };
    req.headers.get = () => null;
    const body = { accessToken: 'jwt-test-token' };
    expect(getToken(req, body)).toBe('jwt-test-token');
  });

  it('extrai token do header Authorization', () => {
    const req = { headers: { get: (k) => k === 'Authorization' ? 'Bearer jwt-from-header' : null } };
    expect(getToken(req, {})).toBe('jwt-from-header');
  });

  it('retorna string vazia sem token', () => {
    const req = { headers: { get: () => null } };
    expect(getToken(req, {})).toBe('');
  });

  it('prioriza Authorization header sobre body.accessToken', () => {
    // getToken lê Authorization primeiro e retorna se for Bearer; body é
    // fallback. Esse comportamento sustenta o apiPost (injeta no header).
    // O teste original esperava o contrário — bug latente descoberto pelo CI.
    const req = { headers: { get: () => 'Bearer header-token' } };
    expect(getToken(req, { accessToken: 'body-token' })).toBe('header-token');
  });
});
