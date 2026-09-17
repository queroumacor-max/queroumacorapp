// __tests__/lib/securityEvents.test.ts — auditoria de observabilidade de
// segurança (2026-09-17). Trava o contrato de `logSecurityEvent`/
// `redactFields`: log estruturado (JSON de uma linha), nunca lança,
// redige secret por CHAVE (Authorization/Cookie/token/etc — sempre
// '[REDACTED]' inteiro, nunca parcial) e mascara PII por CONTEÚDO
// (email/telefone/CPF/CNPJ/JWT/Bearer) mesmo fora de uma chave "óbvia".
// Cobre também log injection (CRLF/control chars) — requisito #122/#198.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureMessage = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import { logSecurityEvent, redactFields, maskSensitiveString } from '@/lib/api/securityEvents';

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captureMessage.mockReset();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

function lastLoggedLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  expect(call).toBeDefined();
  // logSecurityEvent chama console.warn/error('[security]', line) — a
  // segunda posição é o JSON.
  const line = call?.[1] as string;
  return JSON.parse(line);
}

describe('redactFields — chave de secret vira [REDACTED] inteiro', () => {
  it('redige Authorization', () => {
    expect(redactFields({ authorization: 'Bearer sk-real-token-xyz' })).toEqual({
      authorization: '[REDACTED]',
    });
  });

  it('redige Cookie (case-insensitive)', () => {
    expect(redactFields({ Cookie: 'sb-session=abc123' })).toEqual({ Cookie: '[REDACTED]' });
  });

  it('redige token/secret/apiKey/password/senha/service_role/otp/webhookSecret', () => {
    const input = {
      token: 'x',
      secret: 'x',
      apiKey: 'x',
      api_key: 'x',
      password: 'x',
      senha: 'x',
      service_role: 'x',
      otp: 'x',
      webhookSecret: 'x',
      refreshToken: 'x',
    };
    const out = redactFields(input) as Record<string, unknown>;
    for (const k of Object.keys(input)) {
      expect(out[k]).toBe('[REDACTED]');
    }
  });

  it('NÃO redige campo comum (falso positivo controlado)', () => {
    expect(redactFields({ route: '/api/whatsapp/send', count: 3 })).toEqual({
      route: '/api/whatsapp/send',
      count: 3,
    });
  });

  it('redige recursivamente em objeto aninhado', () => {
    const out = redactFields({ detail: { headers: { authorization: 'Bearer abc' } } });
    expect(out).toEqual({ detail: { headers: { authorization: '[REDACTED]' } } });
  });

  it('redige dentro de arrays', () => {
    const out = redactFields({ list: [{ token: 'abc' }, { ok: true }] });
    expect(out).toEqual({ list: [{ token: '[REDACTED]' }, { ok: true }] });
  });

  it('não trava em referência circular / profundidade excessiva', () => {
    const a: Record<string, unknown> = { token: 'x' };
    a.self = a;
    expect(() => redactFields(a)).not.toThrow();
  });

  it('trunca objeto com muitas chaves (defesa contra flood)', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) big[`k${i}`] = i;
    const out = redactFields(big) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
  });
});

describe('maskSensitiveString / redactFields — PII por conteúdo', () => {
  it('mascara email dentro de uma string qualquer', () => {
    expect(maskSensitiveString('contato: foo@bar.com')).toBe('contato: foo***@bar.com');
  });

  it('mascara telefone BR', () => {
    expect(maskSensitiveString('11959765031')).toBe('***********');
  });

  it('mascara JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(maskSensitiveString(jwt)).toBe('[JWT_REDACTED]');
  });

  it('mascara "Bearer <token>" mesmo fora de uma chave Authorization', () => {
    expect(maskSensitiveString('Authorization was Bearer abc.def-ghi123')).toContain(
      'Bearer [REDACTED]',
    );
  });

  it('redactFields aplica maskSensitiveString em campo não-secret com PII embutida', () => {
    const out = redactFields({ key: 'jackson.guerra@gmail.com' }) as Record<string, unknown>;
    expect(out.key).toBe('jac***@gmail.com');
  });
});

describe('log injection (#122) — control chars nunca passam', () => {
  it('remove CRLF do nome do evento', () => {
    logSecurityEvent('auth.login.failed\r\n[FAKE] admin.promoted', {}, { severity: 'warning' });
    const record = lastLoggedLine(warnSpy);
    expect(record.event as string).not.toContain('\n');
    expect(record.event as string).not.toContain('\r');
  });

  it('remove CRLF/control chars de valores de campo', () => {
    logSecurityEvent(
      'security.webhook.invalid_signature',
      { reason: 'x\r\n[FAKE] {"event":"admin.promoted"}' },
      { severity: 'warning' },
    );
    const record = lastLoggedLine(warnSpy);
    expect(JSON.stringify(record)).not.toMatch(/[\r\n]/);
  });
});

describe('logSecurityEvent — nunca lança', () => {
  it('sobrevive a objeto circular nos fields', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => logSecurityEvent('security.rate_limit.hit', circular)).not.toThrow();
  });

  it('sobrevive a event undefined/estranho', () => {
    // @ts-expect-error — testando robustez contra chamador incorreto
    expect(() => logSecurityEvent(undefined, {})).not.toThrow();
  });
});

describe('logSecurityEvent — shape estruturado', () => {
  it('grava JSON de uma linha com event/severity/ts/request_id', () => {
    logSecurityEvent('security.rate_limit.hit', { endpoint: 'whatsapp-send' }, { severity: 'warning' });
    const record = lastLoggedLine(warnSpy);
    expect(record.event).toBe('security.rate_limit.hit');
    expect(record.severity).toBe('warning');
    expect(typeof record.ts).toBe('string');
    expect(record.endpoint).toBe('whatsapp-send');
  });

  it('correlaciona com x-request-id quando o request é passado', () => {
    const request = new Request('https://x.com', { headers: { 'x-request-id': 'req-abc-123' } });
    logSecurityEvent('auth.login.failed', {}, { severity: 'warning', request });
    const record = lastLoggedLine(warnSpy);
    expect(record.request_id).toBe('req-abc-123');
  });

  it('severity default é "info" e vai por console.warn (não console.error)', () => {
    logSecurityEvent('security.upload.rejected', {});
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const record = lastLoggedLine(warnSpy);
    expect(record.severity).toBe('info');
  });

  it('severity "high"/"critical" vai por console.error, não console.warn', () => {
    logSecurityEvent('security.webhook.replay_suspected', {}, { severity: 'high' });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('logSecurityEvent — severidade critical aciona Sentry (mesmo padrão já usado no repo)', () => {
  it('chama Sentry.captureMessage só para severity critical', async () => {
    logSecurityEvent('security.privilege_escalation_blocked', { role: 'admin' }, { severity: 'critical' });
    await vi.waitFor(() => expect(captureMessage).toHaveBeenCalledTimes(1));
    expect(captureMessage).toHaveBeenCalledWith(
      'security:security.privilege_escalation_blocked',
      expect.objectContaining({ tags: { security_event: 'security.privilege_escalation_blocked' } }),
    );
  });

  it('NÃO chama Sentry pra severity warning/high/info (evita flood de Issues)', async () => {
    logSecurityEvent('security.rate_limit.hit', {}, { severity: 'warning' });
    logSecurityEvent('security.webhook.replay_suspected', {}, { severity: 'high' });
    logSecurityEvent('security.upload.rejected', {}, { severity: 'info' });
    await new Promise((r) => setTimeout(r, 0));
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('falha do Sentry não propaga (resiliência)', async () => {
    captureMessage.mockImplementationOnce(() => {
      throw new Error('sentry down');
    });
    expect(() =>
      logSecurityEvent('security.config.service_role_missing', {}, { severity: 'critical' }),
    ).not.toThrow();
  });
});
