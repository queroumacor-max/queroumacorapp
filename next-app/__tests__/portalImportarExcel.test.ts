// Importador de leads: Excel direto (.xls/.xlsx) — 2026-09-09.
//
// O SheetJS vive vendorado em public/portal/xlsx.full.min.js e entra por
// <script> dinâmico com SRI. Se alguém trocar o arquivo e esquecer o hash
// no app.jsx, o navegador recusa o script em silêncio e a tela diz "não
// consegui carregar o leitor de Excel" — este teste pega isso no CI. As
// funções puras (extensão, célula→texto, matriz) são avaliadas do fonte.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

let fonte = '';
let XLSX_SRI = '';
let ehArquivoExcel: (n: string) => boolean;
let celulaParaTexto: (v: unknown) => string;
let matrizDaPlanilha: (X: unknown, buf: ArrayBuffer) => string[][];

beforeAll(() => {
  fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  const i = fonte.indexOf('// [teste:xlsx-inicio]');
  const f = fonte.indexOf('// [teste:xlsx-fim]');
  expect(i).toBeGreaterThan(0);
  expect(f).toBeGreaterThan(i);
  ({ XLSX_SRI, ehArquivoExcel, celulaParaTexto, matrizDaPlanilha } = new Function(
    `${fonte.slice(i, f)}; return { XLSX_SRI, ehArquivoExcel, celulaParaTexto, matrizDaPlanilha };`
  )());
});

describe('SheetJS vendorado', () => {
  it('o hash SRI do app.jsx bate com o arquivo em public/portal', () => {
    const bytes = readFileSync(join(process.cwd(), 'public/portal/xlsx.full.min.js'));
    const hash = 'sha384-' + createHash('sha384').update(bytes).digest('base64');
    expect(XLSX_SRI).toBe(hash);
  });
  it('o input aceita xlsx/xls além de csv e o texto da tela diz isso', () => {
    expect(fonte).toContain('accept=".csv,.txt,.xlsx,.xlsm,.xls,.ods,');
    expect(fonte).toContain('Aceita <strong>Excel direto (.xlsx, .xls)</strong> ou CSV');
  });
});

describe('ehArquivoExcel', () => {
  it('xlsx/xls/xlsm/ods → true; csv/txt → false (esses seguem no parser nosso)', () => {
    for (const n of ['leads.xlsx', 'LEADS.XLS', 'a.xlsm', 'b.ods']) expect(ehArquivoExcel(n)).toBe(true);
    for (const n of ['leads.csv', 'leads.txt', 'leads', '']) expect(ehArquivoExcel(n)).toBe(false);
  });
});

describe('celulaParaTexto', () => {
  it('telefone guardado como número NÃO vira notação científica', () => {
    expect(celulaParaTexto(11987654321)).toBe('11987654321');
    expect(celulaParaTexto(5511987654321)).toBe('5511987654321');
  });
  it('vazio, texto e decimal', () => {
    expect(celulaParaTexto(null)).toBe('');
    expect(celulaParaTexto(undefined)).toBe('');
    expect(celulaParaTexto(' Pinturas Silva ')).toBe(' Pinturas Silva ');
    expect(celulaParaTexto(4.5)).toBe('4.5');
  });
});

describe('matrizDaPlanilha', () => {
  it('lê a PRIMEIRA aba, converte células e descarta linha vazia', () => {
    const fake = {
      read: () => ({ SheetNames: ['Leads', 'Outra'], Sheets: { Leads: {}, Outra: {} } }),
      utils: {
        sheet_to_json: () => [
          ['Nome', 'Telefone', 'Cidade'],
          ['Pinturas Silva', 11987654321, 'Guarulhos'],
          ['', '', ''],
          ['Arte Fina', '11 4803-6664', ''],
        ],
      },
    };
    expect(matrizDaPlanilha(fake, new ArrayBuffer(0))).toEqual([
      ['Nome', 'Telefone', 'Cidade'],
      ['Pinturas Silva', '11987654321', 'Guarulhos'],
      ['Arte Fina', '11 4803-6664', ''],
    ]);
  });
  it('pasta sem aba → matriz vazia (a tela diz que falta cabeçalho)', () => {
    const fake = { read: () => ({ SheetNames: [], Sheets: {} }), utils: { sheet_to_json: () => [] } };
    expect(matrizDaPlanilha(fake, new ArrayBuffer(0))).toEqual([]);
  });
});
