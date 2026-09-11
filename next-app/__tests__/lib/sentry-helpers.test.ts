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

// ─── Auditoria de segredos (2026-09-11) ─────────────────────────────────────
//
// O Sentry anexa ao evento a URL da request, os breadcrumbs de fetch de saída
// e o texto das exceções — três caminhos por onde um segredo chega lá sem
// passar por `console.*`. Estes testes travam que o beforeSend limpa TODOS.

import { redactSecrets, scrubUrl } from '../../lib/sentry-helpers';

describe('redactSecrets', () => {
  it('troca o valor de parâmetro sensível na query, mantendo o nome', () => {
    expect(redactSecrets('https://x/api/whatsapp/webhook?token=abc123&x=1')).toBe(
      'https://x/api/whatsapp/webhook?token=[REDACTED]&x=1',
    );
    expect(redactSecrets('https://g/v1beta/models?key=AIzaSyXYZ&pageSize=2')).toBe(
      'https://g/v1beta/models?key=[REDACTED]&pageSize=2',
    );
  });

  it('mascara Bearer e chaves de provedor soltas no texto', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop.qrs')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(redactSecrets('falhou com sk-proj-abcdefghijklmnopqrstuvwxyz0123')).toBe(
      'falhou com [KEY_REDACTED]',
    );
    expect(redactSecrets('chave AIzaSyA1234567890abcdefghijklmnopqrstuv')).toBe(
      'chave [KEY_REDACTED]',
    );
  });

  it('mascara bloco PEM inteiro', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIB\nabc\n-----END PRIVATE KEY-----';
    expect(redactSecrets(`env: ${pem}!`)).toBe('env: [PRIVATE_KEY_REDACTED]!');
  });

  it('não altera string sem segredo', () => {
    expect(redactSecrets('https://x/feed?page=2&q=tinta')).toBe('https://x/feed?page=2&q=tinta');
  });
});

describe('scrubUrl', () => {
  it('descarta o fragment inteiro (onde o OAuth web entrega a sessão)', () => {
    expect(scrubUrl('https://x/completar-perfil#access_token=eyJa.bb.cc&refresh_token=zzz')).toBe(
      'https://x/completar-perfil',
    );
  });

  it('redige a query e preserva o resto', () => {
    expect(scrubUrl('https://x/api/whatsapp/followup?token=s3cr3t&dryRun=1')).toBe(
      'https://x/api/whatsapp/followup?token=[REDACTED]&dryRun=1',
    );
  });
});

describe('sentryBeforeSend — segredos', () => {
  it('limpa request.url, query_string, headers sensíveis e cookies', () => {
    const event = {
      request: {
        url: 'https://x/api/whatsapp/webhook?token=s3cr3t',
        query_string: 'token=s3cr3t&a=1',
        headers: {
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
          'x-internal-secret': 'abc',
          Cookie: 'sb-session-token=xyz',
          'user-agent': 'UA',
        },
        cookies: { 'sb-session-token': 'xyz' },
      },
    };
    const out = sentryBeforeSend(event);
    expect(out.request.url).toBe('https://x/api/whatsapp/webhook?token=[REDACTED]');
    expect(out.request.query_string).toBe('token=[REDACTED]&a=1');
    expect(out.request.headers).toEqual({
      Authorization: '[REDACTED]',
      'x-internal-secret': '[REDACTED]',
      Cookie: '[REDACTED]',
      'user-agent': 'UA',
    });
    expect(out.request.cookies).toBe('[REDACTED]');
  });

  it('limpa breadcrumbs de fetch (url + message) e texto da exceção', () => {
    const event = {
      breadcrumbs: [
        {
          message: 'GET https://g/v1beta/models?key=AIzaSyA1234567890abcdefghijklmnopqrstuv',
          data: { url: 'https://g/v1beta/models?key=AIzaSyA1234567890abcdefghijklmnopqrstuv', method: 'GET' },
        },
      ],
      exception: { values: [{ value: 'fetch failed: Bearer abcdefghijklmnop' }] },
      message: 'erro em ?token=abc',
    };
    const out = sentryBeforeSend(event);
    expect(out.breadcrumbs[0].data.url).toBe('https://g/v1beta/models?key=[REDACTED]');
    expect(out.breadcrumbs[0].message).not.toContain('AIzaSyA1234567890');
    expect(out.exception.values[0].value).toBe('fetch failed: Bearer [REDACTED]');
    expect(out.message).toBe('erro em ?token=[REDACTED]');
  });
});
