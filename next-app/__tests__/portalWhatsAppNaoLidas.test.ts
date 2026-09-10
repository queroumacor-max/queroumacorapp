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
interface Linha { id: string; direction: 'in' | 'out'; wa_id: string; body?: string | null; created_at: string; delivery_status?: string | null }
let mesclarMensagens: (atual: Linha[], chegadas: Linha[] | null) => Linha[];
let sufixoDoTelefone: (tel: unknown) => string | null;
let pedacos: <T>(l: T[], n: number) => T[][];
let WA_DIAS_LISTA: number;
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
  ({ contarNaoLidas, filtrarConversas, mesclarMensagens, sufixoDoTelefone, pedacos, WA_DIAS_LISTA } = new Function(
    `${bloco}; return { contarNaoLidas, filtrarConversas, mesclarMensagens, sufixoDoTelefone, pedacos, WA_DIAS_LISTA };`
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

// ── A lista deixou de ser "as últimas 500 mensagens" (2026-09-09) ────────

const linha = (id: string, o: Partial<Linha> = {}): Linha => ({
  id, direction: 'out', wa_id: '5511999990001', body: 'oi', created_at: '2026-09-09T10:00:00Z', ...o,
});

describe('mesclarMensagens', () => {
  it('devolve o MESMO array quando nada mudou (o poll não repinta à toa)', () => {
    const atual = [linha('a'), linha('b')];
    expect(mesclarMensagens(atual, [linha('a'), linha('b')])).toBe(atual);
    expect(mesclarMensagens(atual, [])).toBe(atual);
    expect(mesclarMensagens(atual, null)).toBe(atual);
  });
  it('acrescenta linha nova e ordena da mais recente pra mais antiga', () => {
    const atual = [linha('a', { created_at: '2026-09-09T10:00:00Z' })];
    const out = mesclarMensagens(atual, [linha('b', { created_at: '2026-09-09T11:00:00Z' }), linha('c', { created_at: '2026-09-09T09:00:00Z' })]);
    expect(out.map(m => m.id)).toEqual(['b', 'a', 'c']);
  });
  it('linha com o mesmo id e status de entrega diferente é ATUALIZAÇÃO (o ✓✓ chega depois)', () => {
    const atual = [linha('a', { delivery_status: 'sent' })];
    const out = mesclarMensagens(atual, [linha('a', { delivery_status: 'read' })]);
    expect(out).not.toBe(atual);
    expect(out[0].delivery_status).toBe('read');
  });
  it('o eco local do envio some quando a linha real do banco chega', () => {
    const atual = [linha('local-123', { body: 'bom dia' }), linha('x', { direction: 'in', body: 'oi' })];
    const out = mesclarMensagens(atual, [linha('m-real', { body: 'bom dia' })]);
    expect(out.map(m => m.id).sort()).toEqual(['m-real', 'x']);
  });
  it('eco local de OUTRA conversa ou outro corpo fica (ainda não confirmado)', () => {
    const atual = [linha('local-1', { body: 'bom dia' }), linha('local-2', { body: 'boa tarde', wa_id: '5511999990002' })];
    const out = mesclarMensagens(atual, [linha('m-real', { body: 'bom dia' })]);
    expect(out.map(m => m.id).sort()).toEqual(['local-2', 'm-real']);
  });
});

describe('sufixoDoTelefone / pedacos', () => {
  it('8 últimos dígitos, com máscara, DDI ou nono dígito', () => {
    expect(sufixoDoTelefone('(11) 97996-4954')).toBe('79964954');
    expect(sufixoDoTelefone('+55 11 97996-4954')).toBe('79964954');
    expect(sufixoDoTelefone('5511979964954')).toBe('79964954');
    expect(sufixoDoTelefone('1234567')).toBeNull();
    expect(sufixoDoTelefone(null)).toBeNull();
  });
  it('pedacos divide sem perder nem repetir', () => {
    expect(pedacos([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(pedacos([], 3)).toEqual([]);
  });
});

describe('a aba WhatsApp não tem mais teto de 500 mensagens', () => {
  it('a lista e o histórico da conversa passam por buscarMensagens (paginado)', () => {
    expect(fonte).not.toMatch(/from\('whatsapp_messages'\)[\s\S]{0,200}\.limit\(500\)/);
    expect(fonte).toContain("aoChegar: entregar, cancelado: () => !vivoRef.current");
    expect(fonte).toContain(".select(cols, extra).eq('wa_id', alvo)");
    expect(fonte).toContain('setMsgs(prev => mesclarMensagens(prev, parcial))');
    expect(fonte).toContain('setMsgs(prev => mesclarMensagens(prev, [payload.new]))');
    expect(WA_DIAS_LISTA).toBeGreaterThanOrEqual(30);
  });
  it('o nome do lead vem pelo telefone da conversa, não pelos 3000 primeiros da tabela', () => {
    expect(fonte).not.toContain("from('leads').select('id, name, phone, category, segment, city, status').not('phone','is',null).limit(3000)");
    expect(fonte).toContain("'phone.ilike.*' + f");
    expect(fonte).toContain('resolverLeads(novos)');
  });
  it('o badge do menu e a marca de leitura não têm teto de linhas', () => {
    expect(fonte).not.toContain(".eq('direction','in').gte('created_at', desde).limit(3000)");
    expect(fonte).not.toContain("select('wa_id, last_read_at').limit(3000)");
    expect(fonte).not.toContain("select('wa_id, enabled, last_why, last_at, last_read_at').limit(2000)");
  });
});
