// Tests do lib/errors-friendly.ts.
// Garante que cada pattern reconhece os erros típicos esperados e que o
// fallback genérico é retornado pra mensagens desconhecidas. Inclui também
// um teste do hook do Sentry (captura no fallback) usando stub no window.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { toFriendlyError, GENERIC_FRIENDLY_ERROR } from '../../lib/errors-friendly';

describe('toFriendlyError — patterns', () => {
  it('reconhece sessão expirada (JWT expired)', () => {
    const r = toFriendlyError(new Error('JWT expired'));
    expect(r.title).toBe('Sessão expirada');
    expect(r.actionable).toBe('Fazer login');
  });

  it('reconhece sessão expirada (not authenticated)', () => {
    const r = toFriendlyError(new Error('user is not authenticated'));
    expect(r.title).toBe('Sessão expirada');
  });

  it('reconhece rate limit', () => {
    const r = toFriendlyError(new Error('Too many requests'));
    expect(r.title).toBe('Muitas tentativas');
  });

  it('reconhece falha de rede', () => {
    const r = toFriendlyError(new Error('fetch failed'));
    expect(r.title).toBe('Sem conexão');
    expect(r.actionable).toBe('Tentar de novo');
  });

  it('reconhece payload too large', () => {
    const r = toFriendlyError(new Error('payload too large'));
    expect(r.title).toBe('Arquivo grande demais');
  });

  it('reconhece duplicate key (Postgres 23505)', () => {
    const r = toFriendlyError(new Error('duplicate key value violates unique constraint (23505)'));
    expect(r.title).toBe('Já existe');
  });

  it('reconhece foreign key (Postgres 23503)', () => {
    const r = toFriendlyError(new Error('insert or update violates foreign key constraint (23503)'));
    expect(r.title).toBe('Item referenciado');
  });

  it('reconhece feature PRO', () => {
    const r = toFriendlyError(new Error('PRO required for this action'));
    expect(r.title).toBe('Feature PRO');
    expect(r.actionable).toBe('Virar PRO');
  });

  it('reconhece acesso restrito a admins', () => {
    const r = toFriendlyError(new Error('admins only'));
    expect(r.title).toBe('Acesso restrito');
  });

  it('reconhece pontos insuficientes', () => {
    const r = toFriendlyError(new Error('insufficient points'));
    expect(r.title).toBe('Pontos insuficientes');
    expect(r.actionable).toBe('Como ganhar pontos');
  });

  it('reconhece timeout', () => {
    const r = toFriendlyError(new Error('request timeout after 30s'));
    expect(r.title).toBe('Tempo esgotado');
  });
});

describe('toFriendlyError — fallback genérico', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devolve GENERIC quando nada casa', () => {
    const r = toFriendlyError(new Error('xyz garbage that nobody recognizes'));
    expect(r).toEqual(GENERIC_FRIENDLY_ERROR);
    expect(r.title).toBe('Algo deu errado');
  });

  it('aceita string crua (não-Error) e cai no genérico', () => {
    const r = toFriendlyError('mensagem solta sem match');
    expect(r.title).toBe('Algo deu errado');
  });

  it('captura no Sentry no caminho do genérico', () => {
    const captureException = vi.fn();
    vi.stubGlobal('window', { Sentry: { captureException } });
    const err = new Error('completely unknown error xyz');
    const r = toFriendlyError(err);
    expect(r).toEqual(GENERIC_FRIENDLY_ERROR);
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it('não chama Sentry quando um pattern casa', () => {
    const captureException = vi.fn();
    vi.stubGlobal('window', { Sentry: { captureException } });
    toFriendlyError(new Error('JWT expired'));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('silencia exceção do próprio Sentry sem propagar', () => {
    const captureException = vi.fn(() => {
      throw new Error('sentry blew up');
    });
    vi.stubGlobal('window', { Sentry: { captureException } });
    // Deve cair no genérico sem lançar.
    expect(() => toFriendlyError(new Error('unknown thing'))).not.toThrow();
  });
});
