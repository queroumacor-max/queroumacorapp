// admin-config.test.ts — R-H6 do REMEDIATION_PLAN.
//
// Cobre o cache + parsing de `ADMIN_EMAILS` em `lib/api/admin-config.ts`:
//   - Lista vazia → ninguém é admin
//   - Lista populada → exact-match case-insensitive
//   - Entrada inválida (sem `@` ou TLD) → ignorada com warn
//   - Espaços em volta → normalizados via trim
//   - Email null/undefined/'' → false
//   - `__resetAdminEmailsCacheForTests` permite mutar entre testes

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isAdminEmail,
  __resetAdminEmailsCacheForTests,
} from '../../lib/api/admin-config';

const originalAdminEmails = process.env.ADMIN_EMAILS;

beforeEach(() => {
  // Silencia warn (entrada inválida loga warn por design).
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // Restaura env e cache pro estado original entre testes.
  if (originalAdminEmails === undefined) {
    delete process.env.ADMIN_EMAILS;
  } else {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  }
  __resetAdminEmailsCacheForTests();
  vi.restoreAllMocks();
});

describe('isAdminEmail — ADMIN_EMAILS vazio', () => {
  it('lista vazia → retorna false pra qualquer email', () => {
    __resetAdminEmailsCacheForTests({ raw: '' });
    expect(isAdminEmail('a@b.co')).toBe(false);
    expect(isAdminEmail('admin@example.com')).toBe(false);
  });

  it('email null/undefined/empty string → false', () => {
    __resetAdminEmailsCacheForTests({ raw: 'a@b.co' });
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail('')).toBe(false);
  });
});

describe('isAdminEmail — lista populada', () => {
  it('ADMIN_EMAILS=a@b.co,c@d.co → true só pra esses emails', () => {
    __resetAdminEmailsCacheForTests({ raw: 'a@b.co,c@d.co' });
    expect(isAdminEmail('a@b.co')).toBe(true);
    expect(isAdminEmail('c@d.co')).toBe(true);
    expect(isAdminEmail('e@f.co')).toBe(false);
  });

  it('case-insensitive: ADMIN_EMAILS contém A@B.CO → matches a@b.co', () => {
    __resetAdminEmailsCacheForTests({ raw: 'A@B.CO,c@d.co' });
    expect(isAdminEmail('a@b.co')).toBe(true);
    expect(isAdminEmail('A@B.CO')).toBe(true);
  });

  it('case-insensitive na consulta: ADMIN_EMAILS=a@b.co → matches A@B.CO', () => {
    __resetAdminEmailsCacheForTests({ raw: 'a@b.co' });
    expect(isAdminEmail('A@B.CO')).toBe(true);
    expect(isAdminEmail('A@b.cO')).toBe(true);
  });
});

describe('isAdminEmail — entradas inválidas', () => {
  it('entrada sem @ é ignorada, a válida funciona', () => {
    __resetAdminEmailsCacheForTests({ raw: 'foo,c@d.co' });
    expect(isAdminEmail('foo')).toBe(false);
    expect(isAdminEmail('c@d.co')).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it('entrada com @ mas sem TLD é ignorada (matcher exige `.` depois do @)', () => {
    __resetAdminEmailsCacheForTests({ raw: 'foo@bar,c@d.co' });
    expect(isAdminEmail('foo@bar')).toBe(false);
    expect(isAdminEmail('c@d.co')).toBe(true);
  });

  it('lista 100% inválida → cache vazio (nenhum admin)', () => {
    __resetAdminEmailsCacheForTests({ raw: 'foo,bar,baz' });
    expect(isAdminEmail('foo')).toBe(false);
    expect(isAdminEmail('foo@bar.co')).toBe(false);
  });
});

describe('isAdminEmail — normalização de whitespace', () => {
  it('espaços em volta de cada entrada são trim-ados', () => {
    __resetAdminEmailsCacheForTests({ raw: '  a@b.co , c@d.co  ' });
    expect(isAdminEmail('a@b.co')).toBe(true);
    expect(isAdminEmail('c@d.co')).toBe(true);
  });

  it('vírgulas consecutivas (entradas vazias) não viram admin', () => {
    __resetAdminEmailsCacheForTests({ raw: 'a@b.co,,,c@d.co' });
    expect(isAdminEmail('a@b.co')).toBe(true);
    expect(isAdminEmail('c@d.co')).toBe(true);
    expect(isAdminEmail('')).toBe(false);
  });
});

describe('__resetAdminEmailsCacheForTests', () => {
  it('reset com novo raw atualiza ADMIN_EMAILS e cache', () => {
    __resetAdminEmailsCacheForTests({ raw: 'a@b.co' });
    expect(isAdminEmail('a@b.co')).toBe(true);
    expect(isAdminEmail('c@d.co')).toBe(false);

    __resetAdminEmailsCacheForTests({ raw: 'c@d.co' });
    expect(isAdminEmail('a@b.co')).toBe(false);
    expect(isAdminEmail('c@d.co')).toBe(true);
  });

  it('reset sem args re-lê process.env.ADMIN_EMAILS atual', () => {
    process.env.ADMIN_EMAILS = 'a@b.co';
    __resetAdminEmailsCacheForTests();
    expect(isAdminEmail('a@b.co')).toBe(true);

    process.env.ADMIN_EMAILS = 'x@y.co';
    __resetAdminEmailsCacheForTests();
    expect(isAdminEmail('a@b.co')).toBe(false);
    expect(isAdminEmail('x@y.co')).toBe(true);
  });
});
