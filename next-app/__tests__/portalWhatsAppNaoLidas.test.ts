// Portal: filtro "Não lidas" na coluna de conversas do WhatsApp (2026-09-09).
//
// Pedido do usuário: um botão que filtra a lista pra só as conversas com
// mensagem NOVA de cliente. O portal é arquivo único sem módulos, então este
// teste lê o fonte, extrai o bloco entre `[teste:wa-lista-inicio]` e
// `[teste:wa-lista-fim]` e avalia com `new Function` — mesmo desenho do
// `portalJanela24h.test.ts`. O bloco só pode ter JS puro: JSX ali quebra o
// parse e o arquivo inteiro vira "skipped", verde na contagem.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Msg { direction: 'in' | 'out'; created_at: string }
interface Conv { waId: string; msgs: Msg[] }

let fonte = '';
let bloco = '';
let contarNaoLidas: (msgs: Msg[] | null | undefined, desde?: string | null) => number;
let filtrarConversas: (
  convs: Conv[],
  o: { busca?: string; soNaoLidas?: boolean; manter?: string | null;
    nomeDe: (c: Conv) => string; naoLidas: (c: Conv) => number }
) => Conv[];

beforeAll(() => {
  fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  const ini = fonte.indexOf('// [teste:wa-lista-inicio]');
  const fim = fonte.indexOf('// [teste:wa-lista-fim]');
  expect(ini).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(ini);
  bloco = fonte.slice(ini, fim);
  ({ contarNaoLidas, filtrarConversas } = new Function(
    `${bloco}; return { contarNaoLidas, filtrarConversas };`
  )());
});

describe('marcadores', () => {
  it('o bloco extraído é só JS (sem JSX) e as duas funções existem', () => {
    expect(bloco).not.toMatch(/<[A-Za-z/]/);
    expect(typeof contarNaoLidas).toBe('function');
    expect(typeof filtrarConversas).toBe('function');
  });
});

const msg = (direction: 'in' | 'out', iso: string): Msg => ({ direction, created_at: iso });

describe('contarNaoLidas', () => {
  it('conversa nunca aberta: conta tudo que foi RECEBIDO', () => {
    expect(contarNaoLidas([
      msg('in', '2026-09-09T10:00:00Z'),
      msg('out', '2026-09-09T10:01:00Z'),
      msg('in', '2026-09-09T10:02:00Z'),
    ], null)).toBe(2);
    expect(contarNaoLidas([], null)).toBe(0);
    expect(contarNaoLidas(null, null)).toBe(0);
  });
  it('só o que chegou DEPOIS da marca de leitura', () => {
    const lista = [
      msg('in', '2026-09-09T10:00:00Z'),
      msg('in', '2026-09-09T11:00:00Z'),
      msg('out', '2026-09-09T12:00:00Z'), // resposta da IA/portal não conta
      msg('in', '2026-09-09T13:00:00Z'),
    ];
    expect(contarNaoLidas(lista, '2026-09-09T10:30:00Z')).toBe(2);
    expect(contarNaoLidas(lista, '2026-09-09T13:00:00Z')).toBe(0);
  });
  it('resposta enviada (IA ou portal) NÃO zera nada — só a marca zera', () => {
    const lista = [msg('in', '2026-09-09T10:00:00Z'), msg('out', '2026-09-09T10:05:00Z')];
    expect(contarNaoLidas(lista, null)).toBe(1);
  });
});

describe('filtrarConversas', () => {
  const convs: Conv[] = [
    { waId: '5511999990001', msgs: [msg('in', '2026-09-09T10:00:00Z')] },
    { waId: '5511999990002', msgs: [msg('in', '2026-09-09T09:00:00Z')] },
    { waId: '5511999990003', msgs: [msg('out', '2026-09-09T09:00:00Z')] },
  ];
  const nomes: Record<string, string> = {
    '5511999990001': 'Maria Pintora', '5511999990002': 'João Fachadas', '5511999990003': 'Loja Tinta',
  };
  const nomeDe = (c: Conv) => nomes[c.waId];
  // a 0002 foi lida às 09:30 (depois da mensagem); a 0001 nunca foi aberta
  const readAt: Record<string, string> = { '5511999990002': '2026-09-09T09:30:00Z' };
  const naoLidas = (c: Conv) => contarNaoLidas(c.msgs, readAt[c.waId]);
  const ids = (l: Conv[]) => l.map(c => c.waId.slice(-4));

  it('sem filtro e sem busca: todas', () => {
    expect(ids(filtrarConversas(convs, { busca: '', soNaoLidas: false, nomeDe, naoLidas }))).toEqual(['0001', '0002', '0003']);
  });
  it('"Não lidas" deixa só quem tem mensagem de cliente sem abrir', () => {
    expect(ids(filtrarConversas(convs, { busca: '', soNaoLidas: true, nomeDe, naoLidas }))).toEqual(['0001']);
  });
  it('a conversa ABERTA fica na lista mesmo depois de marcada como lida', () => {
    // abrir marca lida → naoLidas vira 0; sem `manter` ela sumiria no mesmo clique
    expect(ids(filtrarConversas(convs, { busca: '', soNaoLidas: true, manter: '5511999990002', nomeDe, naoLidas })))
      .toEqual(['0001', '0002']);
  });
  it('busca por nome e por dígitos do número (com máscara)', () => {
    expect(ids(filtrarConversas(convs, { busca: 'joão', nomeDe, naoLidas }))).toEqual(['0002']);
    expect(ids(filtrarConversas(convs, { busca: '(11) 99999-0003', nomeDe, naoLidas }))).toEqual(['0003']);
  });
  it('busca combina com "Não lidas" (procura DENTRO das não lidas)', () => {
    expect(ids(filtrarConversas(convs, { busca: 'maria', soNaoLidas: true, nomeDe, naoLidas }))).toEqual(['0001']);
    expect(ids(filtrarConversas(convs, { busca: 'joão', soNaoLidas: true, nomeDe, naoLidas }))).toEqual([]);
  });
  it('busca só com símbolos não casa todo número por acidente', () => {
    // "§" era o truque antigo pra `includes('')` não casar tudo; a regra agora é explícita
    expect(ids(filtrarConversas(convs, { busca: '---', nomeDe, naoLidas }))).toEqual([]);
  });
});

describe('a aba WhatsApp usa as funções puras (não uma cópia)', () => {
  it('naoLidas e convsFiltradas passam pelo bloco testado', () => {
    expect(fonte).toContain('const naoLidas = (c) => contarNaoLidas(c.msgs, readAt[c.waId]);');
    expect(fonte).toContain('filtrarConversas(convs, { busca, soNaoLidas, manter: openWa, nomeDe, naoLidas })');
  });
  it('o botão existe, mostra a contagem de CONVERSAS e tem item na ajuda', () => {
    expect(fonte).toContain("setSoNaoLidas(v => !v)");
    expect(fonte).toContain('const conversasNaoLidas = convs.reduce((n, c) => n + (naoLidas(c) > 0 ? 1 : 0), 0);');
    expect(fonte).toContain("t:'● Não lidas (em cima da lista de conversas)'");
  });
});
