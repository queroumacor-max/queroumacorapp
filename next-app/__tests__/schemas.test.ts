// Tests do port lib/schemas.ts (zod nativo).
// Port direto de tests/schemas.test.js. Como a API mudou de
// `{ ok, value, error: { code, message } }` pro shape do Zod
// `{ success, data, error: ZodError }`, adaptamos as asserções —
// mas mantemos a mesma cobertura por schema.

import { describe, it, expect } from 'vitest';
import {
  emailSchema,
  passwordSchema,
  strongPasswordSchema,
  passwordWithMin,
  passwordsMatchSchema,
  requiredField,
  brlSchema,
  areaSchema,
  phoneSchema,
  cepSchema,
  cpfSchema,
  cnpjSchema,
  tagSchema,
  urlSchema,
  dateBRSchema,
  Schemas,
  isValidCPF,
  isValidCNPJ,
} from '../lib/schemas';

describe('Schemas — shape', () => {
  it('Schemas aggregator expõe os 13 schemas', () => {
    const expected = [
      'email',
      'password',
      'strongPassword',
      'passwordsMatch',
      'required',
      'brl',
      'area',
      'phone',
      'cep',
      'cpf',
      'cnpj',
      'tag',
      'url',
      'dateBR',
    ] as const;
    for (const k of expected) {
      expect(typeof (Schemas as unknown as Record<string, unknown>)[k]).toBe('object');
    }
  });
});

describe('Schemas.email', () => {
  it('aceita válido', () => {
    const r = emailSchema.safeParse('a@b.co');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('a@b.co');
  });
  it('faz trim', () => {
    const r = emailSchema.safeParse('  a@b.co ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('a@b.co');
  });
  it('rejeita vazio', () => {
    expect(emailSchema.safeParse('').success).toBe(false);
  });
  it('rejeita sem @', () => {
    expect(emailSchema.safeParse('foo.com').success).toBe(false);
  });
});

describe('Schemas.password / strongPassword', () => {
  it('password aceita preenchida', () => {
    expect(passwordSchema.safeParse('x').success).toBe(true);
  });
  it('password rejeita vazia', () => {
    expect(passwordSchema.safeParse('').success).toBe(false);
  });
  it('strongPassword rejeita < 8', () => {
    expect(strongPasswordSchema.safeParse('1234567').success).toBe(false);
  });
  it('strongPassword aceita 8+', () => {
    expect(strongPasswordSchema.safeParse('12345678').success).toBe(true);
  });
  it('passwordWithMin custom', () => {
    expect(passwordWithMin(3).safeParse('abc').success).toBe(true);
    expect(passwordWithMin(3).safeParse('ab').success).toBe(false);
  });
});

describe('Schemas.passwordsMatch', () => {
  it('rejeita diferentes', () => {
    expect(passwordsMatchSchema.safeParse({ a: 'x', b: 'y' }).success).toBe(false);
  });
  it('aceita iguais', () => {
    expect(passwordsMatchSchema.safeParse({ a: 'z', b: 'z' }).success).toBe(true);
  });
});

describe('Schemas.required', () => {
  it('rejeita vazio', () => {
    expect(requiredField('Nome').safeParse('').success).toBe(false);
  });
  it('aceita texto', () => {
    expect(requiredField('Nome').safeParse('João').success).toBe(true);
  });
});

describe('Schemas.brl', () => {
  it('aceita "100"', () => {
    const r = brlSchema.safeParse('100');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe(100);
  });
  it('aceita "1.500,50"', () => {
    const r = brlSchema.safeParse('1.500,50');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeCloseTo(1500.5);
  });
  it('rejeita negativo', () => {
    expect(brlSchema.safeParse('-5').success).toBe(false);
  });
});

describe('Schemas.area', () => {
  it('rejeita 0', () => {
    expect(areaSchema.safeParse('0').success).toBe(false);
  });
  it('aceita "80,5"', () => {
    const r = areaSchema.safeParse('80,5');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeCloseTo(80.5);
  });
});

describe('Schemas.phone', () => {
  it('normaliza com máscara', () => {
    const r = phoneSchema.safeParse('(11) 95976-5031');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('5511959765031');
  });
  it('aceita DDI 55', () => {
    expect(phoneSchema.safeParse('+5511959765031').success).toBe(true);
  });
  it('rejeita curto', () => {
    expect(phoneSchema.safeParse('1234').success).toBe(false);
  });
});

describe('Schemas.cep', () => {
  it('aceita com hífen', () => {
    const r = cepSchema.safeParse('01310-100');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('01310100');
  });
  it('rejeita 7 dígitos', () => {
    expect(cepSchema.safeParse('0131010').success).toBe(false);
  });
});

describe('Schemas.cpf', () => {
  it('aceita válido', () => {
    expect(cpfSchema.safeParse('529.982.247-25').success).toBe(true);
  });
  it('rejeita DV errado', () => {
    expect(cpfSchema.safeParse('529.982.247-99').success).toBe(false);
  });
  it('rejeita sequência (mesmos dígitos)', () => {
    expect(cpfSchema.safeParse('111.111.111-11').success).toBe(false);
  });
  it('isValidCPF puro', () => {
    expect(isValidCPF('52998224725')).toBe(true);
    expect(isValidCPF('11111111111')).toBe(false);
  });
});

describe('Schemas.cnpj', () => {
  it('aceita válido', () => {
    expect(cnpjSchema.safeParse('11.222.333/0001-81').success).toBe(true);
  });
  it('rejeita DV errado', () => {
    expect(cnpjSchema.safeParse('11.222.333/0001-00').success).toBe(false);
  });
  it('isValidCNPJ puro', () => {
    expect(isValidCNPJ('11222333000181')).toBe(true);
    expect(isValidCNPJ('00000000000000')).toBe(false);
  });
});

describe('Schemas.tag', () => {
  it('aceita handle', () => {
    const r = tagSchema.safeParse('joaovictor');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('joaovictor');
  });
  it('lower-case', () => {
    const r = tagSchema.safeParse('JoaoV');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('joaov');
  });
  it('rejeita curto', () => {
    expect(tagSchema.safeParse('jo').success).toBe(false);
  });
  it('rejeita caractere especial', () => {
    expect(tagSchema.safeParse('joao.victor').success).toBe(false);
  });
});

describe('Schemas.url', () => {
  it('aceita https', () => {
    expect(urlSchema.safeParse('https://queroumacor.com.br').success).toBe(true);
  });
  it('rejeita ftp', () => {
    expect(urlSchema.safeParse('ftp://exemplo.com').success).toBe(false);
  });
});

describe('Schemas.dateBR', () => {
  it('aceita dd/mm/aaaa', () => {
    expect(dateBRSchema.safeParse('15/03/2026').success).toBe(true);
  });
  it('rejeita 31/02', () => {
    expect(dateBRSchema.safeParse('31/02/2026').success).toBe(false);
  });
  it('rejeita lixo', () => {
    expect(dateBRSchema.safeParse('hoje').success).toBe(false);
  });
  it('aceita ISO', () => {
    expect(dateBRSchema.safeParse('2026-03-15').success).toBe(true);
  });
});

describe('Schemas — optional via zod', () => {
  it('email.optional() aceita undefined', () => {
    expect(emailSchema.optional().safeParse(undefined).success).toBe(true);
  });
  it('email.optional() ainda valida quando preenchido', () => {
    expect(emailSchema.optional().safeParse('a@b.co').success).toBe(true);
    expect(emailSchema.optional().safeParse('foo').success).toBe(false);
  });
});
