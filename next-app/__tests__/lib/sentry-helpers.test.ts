// Tests de lib/sentry-helpers.ts — R-H4 do REMEDIATION_PLAN.
//
// Antes de mandar eventos pro Sentry, o beforeSend mascara PII (email,
// phone BR, CPF, CNPJ, JWT) em user/request/extra/contexts. Os testes
// travam o contrato e a profundidade máxima de recursão pra não
// estourar a stack em payloads loop/profundos.

import { describe, it, expect } from 'vitest';
import { maskPii, maskPiiDeep, sentryBeforeSend } from '../../lib/sentry-helpers';

describe('maskPii', () => {
  it('mascara email mantendo prefixo (até 3 chars) + domínio', () => {
    expect(maskPii('foo@bar.com')).toBe('foo***@bar.com');
  });

  it('mascara emails mais longos', () => {
    expect(maskPii('jackson.guerra@gmail.com')).toBe('jac***@gmail.com');
  });

  it('mascara telefone BR (11 dígitos)', () => {
    expect(maskPii('11959765031')).toBe('***********');
  });

  it('mascara CPF (com pontuação)', () => {
    expect(maskPii('123.456.789-00')).toBe('***.***.***-**');
  });

  it('mascara CPF sem pontuação como telefone (11 dígitos ambíguos)', () => {
    // 11 dígitos sem pontuação batem na regex BR (mesmo formato).
    // Resultado: mascarado como phone — ainda é redação total, ok.
    expect(maskPii('12345678900')).toBe('***********');
  });

  it('mascara CNPJ', () => {
    expect(maskPii('47.677.346/0001-92')).toBe('**.***.***/****-**');
  });

  it('mascara JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(maskPii(jwt)).toBe('[JWT_REDACTED]');
  });

  it('passa string vazia sem erro', () => {
    expect(maskPii('')).toBe('');
  });

  it('preserva texto sem PII', () => {
    expect(maskPii('lorem ipsum dolor sit amet')).toBe('lorem ipsum dolor sit amet');
  });

  it('mascara múltiplos tipos de PII na mesma string', () => {
    const out = maskPii('Contato: foo@bar.com tel 11959765031');
    expect(out).toContain('foo***@bar.com');
    expect(out).toContain('***********');
  });
});

describe('maskPiiDeep', () => {
  it('mascara strings em objeto raso', () => {
    const out = maskPiiDeep({ email: 'foo@bar.com', name: 'João' });
    expect(out).toEqual({ email: 'foo***@bar.com', name: 'João' });
  });

  it('mascara PII em objeto aninhado', () => {
    const out = maskPiiDeep({ user: { email: 'foo@bar.com', phone: '11959765031' } });
    expect(out).toEqual({ user: { email: 'foo***@bar.com', phone: '***********' } });
  });

  it('mascara dentro de arrays', () => {
    const out = maskPiiDeep(['foo@bar.com', '11959765031', 'safe']);
    expect(out).toEqual(['foo***@bar.com', '***********', 'safe']);
  });

  it('preserva primitivos não-string', () => {
    const out = maskPiiDeep({ count: 5, active: true, ratio: 0.1, missing: null });
    expect(out).toEqual({ count: 5, active: true, ratio: 0.1, missing: null });
  });

  it('para a recursão na profundidade > 6 sem estourar stack', () => {
    // Cria objeto com 20 níveis de aninhamento. Sem o cap, isso é
    // só pra confirmar que não dispara RangeError; um payload self-
    // referential real é coberto no teste seguinte.
    let nested: Record<string, unknown> = { email: 'foo@bar.com' };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    expect(() => maskPiiDeep(nested)).not.toThrow();
  });

  it('não trava em referência circular (graças ao cap de profundidade)', () => {
    const a: Record<string, unknown> = { email: 'foo@bar.com' };
    a.self = a;
    expect(() => maskPiiDeep(a)).not.toThrow();
  });
});

describe('sentryBeforeSend', () => {
  it('mascara user.email', () => {
    const event = { user: { email: 'foo@bar.com' } };
    const out = sentryBeforeSend(event);
    expect(out.user?.email).toBe('foo***@bar.com');
  });

  it('mascara request.data (nested)', () => {
    const event = { request: { data: { phone: '11959765031', cpf: '123.456.789-00' } } };
    const out = sentryBeforeSend(event);
    expect(out.request?.data).toEqual({ phone: '***********', cpf: '***.***.***-**' });
  });

  it('mascara extra + contexts', () => {
    const event = {
      extra: { email: 'foo@bar.com' },
      contexts: { auth: { phone: '11959765031' } },
    };
    const out = sentryBeforeSend(event);
    expect(out.extra).toEqual({ email: 'foo***@bar.com' });
    expect(out.contexts).toEqual({ auth: { phone: '***********' } });
  });

  it('não quebra com event vazio', () => {
    expect(() => sentryBeforeSend({})).not.toThrow();
  });

  it('não quebra se user.email for null', () => {
    const event: { user: { email: string | null } } = { user: { email: null } };
    const out = sentryBeforeSend(event);
    expect(out.user.email).toBeNull();
  });
});
