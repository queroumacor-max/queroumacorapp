// Tests dos 13 schemas em /schemas/*.js (shape estilo Zod).
// Cada arquivo é IIFE que popula window.Schemas via window.Schemas._core. Lemos
// _core primeiro, depois primitives/documents/social/index em sequência, todos
// no mesmo fake window — assim reproduzimos a ordem de carregamento do browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
function load(name){ return readFileSync(join(__dirname, '..', 'schemas', name), 'utf8'); }

/** @type {any} */
const fakeWindow = {};
for (const f of ['_core.js','primitives.js','documents.js','social.js','index.js']){
  new Function('window', load(f))(fakeWindow);
}
const S = fakeWindow.Schemas;

describe('Schemas — shape', () => {
  it('expõe os 13 schemas esperados + helper parse + _names', () => {
    const expected = ['email','password','passwordsMatch','required','brl','area','phone','cep','cpf','cnpj','tag','url','dateBR'];
    for (const k of expected) expect(typeof S[k].parse).toBe('function');
    expect(typeof S.parse).toBe('function');
    expect(Array.isArray(S._names)).toBe(true);
    expect(S._names.length).toBe(13);
  });
  it('cada schema tem .optional() e .refine() chainable', () => {
    expect(typeof S.email.optional).toBe('function');
    expect(typeof S.email.refine).toBe('function');
    expect(typeof S.cpf.optional().parse).toBe('function');
  });
  it('error tem { code, message }', () => {
    const r = S.email.parse('foo');
    expect(r.ok).toBe(false);
    expect(typeof r.error.code).toBe('string');
    expect(typeof r.error.message).toBe('string');
  });
});

describe('Schemas.email', () => {
  it('aceita válido', () => { const r = S.email.parse('a@b.co'); expect(r.ok).toBe(true); expect(r.value).toBe('a@b.co'); });
  it('faz trim', () => { expect(S.email.parse('  a@b.co ').value).toBe('a@b.co'); });
  it('rejeita vazio', () => { expect(S.email.parse('').error.code).toBe('required'); });
  it('rejeita sem @', () => { expect(S.email.parse('foo.com').error.code).toBe('invalid_format'); });
});

describe('Schemas.password', () => {
  it('rejeita curto', () => { expect(S.password.parse('1234567').error.code).toBe('too_short'); });
  it('aceita 8+', () => { expect(S.password.parse('12345678').ok).toBe(true); });
  it('min customizado', () => { expect(S.password.parse('abc', { min:3 }).ok).toBe(true); });
});

describe('Schemas.passwordsMatch', () => {
  it('rejeita diferentes', () => { expect(S.passwordsMatch.parse({ a:'x', b:'y' }).error.code).toBe('mismatch'); });
  it('aceita iguais', () => { expect(S.passwordsMatch.parse({ a:'z', b:'z' }).ok).toBe(true); });
});

describe('Schemas.required', () => {
  it('rejeita vazio', () => { expect(S.required.parse('', 'Nome').error.code).toBe('required'); });
  it('aceita texto', () => { expect(S.required.parse('João', 'Nome').ok).toBe(true); });
});

describe('Schemas.brl', () => {
  it('aceita "100"', () => { expect(S.brl.parse('100').value).toBe(100); });
  it('aceita "1.500,50"', () => { expect(S.brl.parse('1.500,50').value).toBeCloseTo(1500.50); });
  it('rejeita negativo', () => { expect(S.brl.parse('-5').error.code).toBe('out_of_range'); });
});

describe('Schemas.area', () => {
  it('rejeita 0', () => { expect(S.area.parse('0').error.code).toBe('out_of_range'); });
  it('aceita "80,5"', () => { expect(S.area.parse('80,5').value).toBeCloseTo(80.5); });
});

describe('Schemas.phone', () => {
  it('normaliza com máscara', () => { expect(S.phone.parse('(11) 95976-5031').value).toBe('5511959765031'); });
  it('aceita DDI 55', () => { expect(S.phone.parse('+5511959765031').ok).toBe(true); });
  it('rejeita curto', () => { expect(S.phone.parse('1234').error.code).toBe('invalid_format'); });
});

describe('Schemas.cep', () => {
  it('aceita com hífen', () => { expect(S.cep.parse('01310-100').value).toBe('01310100'); });
  it('rejeita 7 dígitos', () => { expect(S.cep.parse('0131010').error.code).toBe('invalid_format'); });
});

describe('Schemas.cpf', () => {
  it('aceita válido', () => { expect(S.cpf.parse('529.982.247-25').ok).toBe(true); });
  it('rejeita DV errado', () => { expect(S.cpf.parse('529.982.247-99').error.code).toBe('invalid_checksum'); });
  it('rejeita sequência', () => { expect(S.cpf.parse('111.111.111-11').error.code).toBe('invalid_checksum'); });
});

describe('Schemas.cnpj', () => {
  it('aceita válido', () => { expect(S.cnpj.parse('11.222.333/0001-81').ok).toBe(true); });
  it('rejeita DV errado', () => { expect(S.cnpj.parse('11.222.333/0001-00').error.code).toBe('invalid_checksum'); });
});

describe('Schemas.tag', () => {
  it('aceita handle', () => { expect(S.tag.parse('joaovictor').value).toBe('joaovictor'); });
  it('lower-case', () => { expect(S.tag.parse('JoaoV').value).toBe('joaov'); });
  it('rejeita curto', () => { expect(S.tag.parse('jo').error.code).toBe('out_of_range'); });
  it('rejeita especial', () => { expect(S.tag.parse('joao.victor').error.code).toBe('invalid_format'); });
});

describe('Schemas.url', () => {
  it('aceita https', () => { expect(S.url.parse('https://queroumacor.com.br').ok).toBe(true); });
  it('rejeita ftp', () => { expect(S.url.parse('ftp://exemplo.com').error.code).toBe('invalid_protocol'); });
});

describe('Schemas.dateBR', () => {
  it('aceita dd/mm/aaaa', () => { expect(S.dateBR.parse('15/03/2026').ok).toBe(true); });
  it('rejeita 31/02', () => { expect(S.dateBR.parse('31/02/2026').error.code).toBe('invalid_date'); });
  it('rejeita lixo', () => { expect(S.dateBR.parse('hoje').error.code).toBe('invalid_format'); });
});

describe('Schemas — chainable helpers', () => {
  it('.optional() aceita vazio como undefined', () => {
    const r = S.email.optional().parse('');
    expect(r.ok).toBe(true);
    expect(r.value).toBe(undefined);
  });
  it('.optional() ainda valida quando preenchido', () => {
    expect(S.email.optional().parse('a@b.co').ok).toBe(true);
    expect(S.email.optional().parse('foo').ok).toBe(false);
  });
  it('.refine() rejeita quando predicado falha', () => {
    const gmail = S.email.refine(v => v.endsWith('@gmail.com'), 'Use Gmail');
    expect(gmail.parse('a@gmail.com').ok).toBe(true);
    const r = gmail.parse('a@yahoo.com');
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('refine_failed');
    expect(r.error.message).toBe('Use Gmail');
  });
  it('Schemas.parse(name, value) delega', () => {
    expect(S.parse('email', 'a@b.co').ok).toBe(true);
    expect(S.parse('inexistente', 'x').error.code).toBe('unknown_schema');
  });
});

describe('Schemas → backward-compat com Validators (delegação)', () => {
  // Carrega validators.js em CIMA do mesmo fakeWindow que já tem Schemas:
  // o adapter viaSchema() deve preferir o caminho Schemas.
  const vsrc = readFileSync(join(__dirname, '..', 'validators.js'), 'utf8');
  new Function('window', vsrc)(fakeWindow);
  const V = fakeWindow.Validators;
  it('validateEmail continua retornando { ok } / { ok, error:string }', () => {
    expect(V.validateEmail('a@b.co').ok).toBe(true);
    const bad = V.validateEmail('foo');
    expect(bad.ok).toBe(false);
    expect(typeof bad.error).toBe('string');
  });
  it('validateCPF preserva forma antiga', () => {
    expect(V.validateCPF('529.982.247-25').ok).toBe(true);
    expect(V.validateCPF('529.982.247-99').error).toBe('CPF inválido');
  });
});
