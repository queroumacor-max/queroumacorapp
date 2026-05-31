// Smoke tests dos 13 validadores em /validators.js.
// validators.js é um IIFE que atribui window.Validators. Pra testar em
// Node, lemos o source e rodamos num escopo controlado via new Function,
// injetando um fake window e capturando o resultado.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'validators.js'), 'utf8');

/** @type {any} */
const fakeWindow = {};
new Function('window', src)(fakeWindow);
const V = fakeWindow.Validators;

describe('Validators — shape', () => {
  it('expõe as 13 funções esperadas', () => {
    const expected = [
      'validateEmail','validatePassword','validatePasswordsMatch','validateRequired',
      'validateBRL','validateArea','validatePhoneBR','validateCEP',
      'validateCPF','validateCNPJ','validateURL','validateHandle','validateDateBR'
    ];
    for (const fn of expected) expect(typeof V[fn]).toBe('function');
  });
});

describe('Validators.validateEmail', () => {
  it('rejeita vazio', () => { expect(V.validateEmail('').ok).toBe(false); });
  it('rejeita sem @', () => { expect(V.validateEmail('foo.com').ok).toBe(false); });
  it('aceita válido', () => { expect(V.validateEmail('a@b.co').ok).toBe(true); });
  it('faz trim', () => { expect(V.validateEmail('  a@b.co  ').ok).toBe(true); });
});

describe('Validators.validatePassword', () => {
  it('rejeita < 8 chars', () => { expect(V.validatePassword('1234567').ok).toBe(false); });
  it('aceita 8 chars', () => { expect(V.validatePassword('12345678').ok).toBe(true); });
  it('aceita maior', () => { expect(V.validatePassword('senhasegura123').ok).toBe(true); });
});

describe('Validators.validatePasswordsMatch', () => {
  it('rejeita diferentes', () => { expect(V.validatePasswordsMatch('a','b').ok).toBe(false); });
  it('aceita iguais', () => { expect(V.validatePasswordsMatch('xyz','xyz').ok).toBe(true); });
});

describe('Validators.validateRequired', () => {
  it('rejeita vazio', () => { expect(V.validateRequired('', 'Nome').ok).toBe(false); });
  it('rejeita só espaços', () => { expect(V.validateRequired('   ', 'Nome').ok).toBe(false); });
  it('aceita texto', () => { expect(V.validateRequired('João', 'Nome').ok).toBe(true); });
});

describe('Validators.validateBRL', () => {
  it('aceita "100"', () => { const r = V.validateBRL('100'); expect(r.ok).toBe(true); expect(r.value).toBe(100); });
  it('aceita "1.500,50"', () => { const r = V.validateBRL('1.500,50'); expect(r.ok).toBe(true); expect(r.value).toBeCloseTo(1500.50); });
  it('rejeita vazio', () => { expect(V.validateBRL('').ok).toBe(false); });
});

describe('Validators.validateArea', () => {
  it('rejeita 0', () => { expect(V.validateArea('0').ok).toBe(false); });
  it('aceita "80,5"', () => { const r = V.validateArea('80,5'); expect(r.ok).toBe(true); expect(r.value).toBeCloseTo(80.5); });
  it('aceita "80"', () => { expect(V.validateArea('80').ok).toBe(true); });
});

describe('Validators.validatePhoneBR', () => {
  it('aceita móvel com máscara', () => { expect(V.validatePhoneBR('(11) 95976-5031').ok).toBe(true); });
  it('normaliza pra E.164 sem +', () => { expect(V.validatePhoneBR('11 95976-5031').value).toBe('5511959765031'); });
  it('aceita com DDI 55', () => { expect(V.validatePhoneBR('+5511959765031').ok).toBe(true); });
  it('rejeita curto', () => { expect(V.validatePhoneBR('1234').ok).toBe(false); });
});

describe('Validators.validateCEP', () => {
  it('aceita com hífen', () => { const r = V.validateCEP('01310-100'); expect(r.ok).toBe(true); expect(r.value).toBe('01310100'); });
  it('aceita sem hífen', () => { expect(V.validateCEP('01310100').ok).toBe(true); });
  it('rejeita 7 dígitos', () => { expect(V.validateCEP('0131010').ok).toBe(false); });
});

describe('Validators.validateCPF', () => {
  it('aceita CPF válido', () => { expect(V.validateCPF('529.982.247-25').ok).toBe(true); });
  it('rejeita CPF inválido (dv errado)', () => { expect(V.validateCPF('529.982.247-99').ok).toBe(false); });
  it('rejeita sequência repetida', () => { expect(V.validateCPF('111.111.111-11').ok).toBe(false); });
});

describe('Validators.validateCNPJ', () => {
  it('aceita CNPJ válido', () => { expect(V.validateCNPJ('11.222.333/0001-81').ok).toBe(true); });
  it('rejeita CNPJ inválido (dv errado)', () => { expect(V.validateCNPJ('11.222.333/0001-00').ok).toBe(false); });
});

describe('Validators.validateURL', () => {
  it('aceita https', () => { expect(V.validateURL('https://queroumacor.com.br').ok).toBe(true); });
  it('aceita http', () => { expect(V.validateURL('http://exemplo.com').ok).toBe(true); });
  it('rejeita ftp', () => { expect(V.validateURL('ftp://exemplo.com').ok).toBe(false); });
});

describe('Validators.validateHandle', () => {
  it('aceita "joaovictor"', () => { expect(V.validateHandle('joaovictor').ok).toBe(true); });
  it('aceita com underscore', () => { expect(V.validateHandle('joao_v').ok).toBe(true); });
  it('rejeita curto (<3)', () => { expect(V.validateHandle('jo').ok).toBe(false); });
  it('rejeita caractere especial', () => { expect(V.validateHandle('joao.victor').ok).toBe(false); });
});

describe('Validators.validateDateBR', () => {
  it('aceita "15/03/2026"', () => { expect(V.validateDateBR('15/03/2026').ok).toBe(true); });
  it('rejeita "31/02/2026" (data impossível)', () => { expect(V.validateDateBR('31/02/2026').ok).toBe(false); });
  it('rejeita formato lixo', () => { expect(V.validateDateBR('hoje').ok).toBe(false); });
});
