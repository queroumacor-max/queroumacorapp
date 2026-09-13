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
interface Resumo { wa_id: string; ultima: Linha | null; nome?: string | null; canal?: string | null; nao_lidas?: number; enabled?: boolean | null; last_why?: string | null; last_at?: string | null; last_read_at?: string | null }
interface ConvR { waId: string; msgs: Linha[]; last: Linha; name: string; resumo: Resumo | null }
let ehFuncaoAusente: (e: unknown) => boolean;
let montarConversas: (resumos: Resumo[] | null, msgs: Linha[]) => ConvR[];
let naoLidasDaConversa: (c: ConvR, marca?: string | null) => number;
let aplicarMensagemNoResumo: (resumos: Resumo[] | null, m: Linha, nova: boolean) => Resumo[] | null;
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
  ({ contarNaoLidas, filtrarConversas, mesclarMensagens, sufixoDoTelefone, pedacos, WA_DIAS_LISTA,
    ehFuncaoAusente, montarConversas, naoLidasDaConversa, aplicarMensagemNoResumo } = new Function(
    `${bloco}; return { contarNaoLidas, filtrarConversas, mesclarMensagens, sufixoDoTelefone, pedacos, WA_DIAS_LISTA,
      ehFuncaoAusente, montarConversas, naoLidasDaConversa, aplicarMensagemNoResumo };`
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
    // 2026-09-13: a conta por conversa passou a considerar o resumo do
    // banco, mas continua caindo em `contarNaoLidas` quando conta na tela.
    expect(fonte).toContain('const naoLidas = (c) => naoLidasDaConversa(c, readAt[c.waId]);');
    expect(bloco).toMatch(/const naoLidasDaConversa = [\s\S]*?contarNaoLidas\(/);
    expect(fonte).toContain('const convs = React.useMemo(() => montarConversas(resumos, msgs), [resumos, msgs]);');
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

// ── Lista por RESUMO no banco (2026-09-13) ─────────────────────────────────
// A tela caía em "57014: statement timeout" baixando as mensagens de 90 dias
// pra montar a coluna. Agora o banco devolve uma linha por conversa
// (`whatsapp_conversas`) e a coluna nasce disso; `msgs` fica pro histórico
// da conversa aberta e pro realtime. Sem a função (SQL pendente), tudo
// continua no desenho de 09/09.

const resumo = (wa_id: string, o: Partial<Resumo> = {}): Resumo => ({
  wa_id, ultima: linha('u-' + wa_id, { wa_id, direction: 'in', body: 'última', created_at: '2026-09-13T10:00:00Z' }),
  nome: null, canal: null, nao_lidas: 0, enabled: null, last_why: null, last_at: null, last_read_at: null, ...o,
});

describe('ehFuncaoAusente', () => {
  it('reconhece função inexistente pelo código do Postgres e do PostgREST', () => {
    expect(ehFuncaoAusente({ code: '42883', message: 'function public.whatsapp_conversas(timestamptz) does not exist' })).toBe(true);
    expect(ehFuncaoAusente({ code: 'PGRST202', message: 'Could not find the function public.whatsapp_conversas(p_desde) in the schema cache' })).toBe(true);
  });
  it('permissão negada, timeout e coluna ausente NÃO são "função ausente" (viram erro na tela)', () => {
    expect(ehFuncaoAusente({ code: '42501', message: 'whatsapp_conversas: acesso de portal necessário' })).toBe(false);
    expect(ehFuncaoAusente({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(ehFuncaoAusente({ code: '42703', message: 'column "delivery_status" does not exist' })).toBe(false);
    expect(ehFuncaoAusente(null)).toBe(false);
  });
});

describe('montarConversas', () => {
  it('sem resumo (SQL pendente) a lista sai só de msgs, como em 09/09', () => {
    const msgs = [
      linha('a', { wa_id: '551', created_at: '2026-09-13T09:00:00Z', direction: 'in' }),
      linha('b', { wa_id: '552', created_at: '2026-09-13T10:00:00Z' }),
      linha('c', { wa_id: '551', created_at: '2026-09-13T11:00:00Z' }),
    ];
    const out = montarConversas(null, msgs);
    expect(out.map(c => c.waId)).toEqual(['551', '552']);
    expect(out[0].last.id).toBe('c');
    expect(out[0].msgs.length).toBe(2);
    expect(out[0].resumo).toBeNull();
  });
  it('resumo cria a conversa mesmo sem NENHUMA mensagem baixada', () => {
    const out = montarConversas([resumo('553', { nome: 'Ana', nao_lidas: 2 })], []);
    expect(out).toHaveLength(1);
    expect(out[0].waId).toBe('553');
    expect(out[0].msgs).toEqual([]);
    expect(out[0].name).toBe('Ana');
    expect(out[0].last.body).toBe('última');
    expect(out[0].resumo?.nao_lidas).toBe(2);
  });
  it('mensagem mais nova em msgs (realtime) vence a última do resumo, e vice-versa', () => {
    const r = resumo('554', { ultima: linha('velha', { wa_id: '554', created_at: '2026-09-13T08:00:00Z' }) });
    const nova = linha('nova', { wa_id: '554', created_at: '2026-09-13T12:00:00Z' });
    expect(montarConversas([r], [nova])[0].last.id).toBe('nova');
    const r2 = resumo('554', { ultima: linha('mais-nova', { wa_id: '554', created_at: '2026-09-13T13:00:00Z' }) });
    expect(montarConversas([r2], [nova])[0].last.id).toBe('mais-nova');
  });
  it('ordena pela mensagem mais recente, misturando as duas fontes', () => {
    const out = montarConversas(
      [resumo('a', { ultima: linha('ua', { wa_id: 'a', created_at: '2026-09-13T10:00:00Z' }) })],
      [linha('mb', { wa_id: 'b', created_at: '2026-09-13T11:00:00Z' })]
    );
    expect(out.map(c => c.waId)).toEqual(['b', 'a']);
  });
});

describe('naoLidasDaConversa', () => {
  const conv = (o: Partial<ConvR>): ConvR => ({ waId: '551', msgs: [], last: linha('x'), name: '', resumo: null, ...o });
  it('sem resumo: conta na tela (contarNaoLidas)', () => {
    const c = conv({ msgs: [linha('1', { direction: 'in', created_at: '2026-09-13T10:00:00Z' }), linha('2', { direction: 'in', created_at: '2026-09-13T11:00:00Z' })] });
    expect(naoLidasDaConversa(c, null)).toBe(2);
    expect(naoLidasDaConversa(c, '2026-09-13T10:30:00Z')).toBe(1);
  });
  it('com resumo e sem marca local: vale o número que o banco contou', () => {
    const c = conv({ resumo: resumo('551', { nao_lidas: 7, last_read_at: '2026-09-13T09:00:00Z' }) });
    expect(naoLidasDaConversa(c, null)).toBe(7);
    // marca local IGUAL à do servidor também é o servidor que manda
    expect(naoLidasDaConversa(c, '2026-09-13T09:00:00Z')).toBe(7);
  });
  it('operador acabou de abrir (marca local mais nova): zera na hora, sem esperar o poll', () => {
    const c = conv({
      resumo: resumo('551', { nao_lidas: 7, last_read_at: '2026-09-13T09:00:00Z' }),
      msgs: [linha('1', { direction: 'in', created_at: '2026-09-13T10:00:00Z' })],
    });
    expect(naoLidasDaConversa(c, '2026-09-13T12:00:00Z')).toBe(0);
    // e o que chegar DEPOIS da marca conta de novo
    c.msgs.push(linha('2', { direction: 'in', created_at: '2026-09-13T12:30:00Z' }));
    expect(naoLidasDaConversa(c, '2026-09-13T12:00:00Z')).toBe(1);
  });
  it('conversa nunca aberta no servidor, mas marcada aqui: a marca local ganha', () => {
    const c = conv({ resumo: resumo('551', { nao_lidas: 3, last_read_at: null }) });
    expect(naoLidasDaConversa(c, '2026-09-13T12:00:00Z')).toBe(0);
  });
});

describe('aplicarMensagemNoResumo (realtime sem esperar o poll)', () => {
  it('sem resumo (caminho antigo) devolve o MESMO valor', () => {
    expect(aplicarMensagemNoResumo(null, linha('m', { direction: 'in' }), true)).toBeNull();
  });
  it('INSERT recebido: vira a última e soma 1 não lida', () => {
    const antes = [resumo('551', { nao_lidas: 1 })];
    const out = aplicarMensagemNoResumo(antes, linha('n', { wa_id: '551', direction: 'in', created_at: '2026-09-13T12:00:00Z', body: 'oi' }), true)!;
    expect(out).not.toBe(antes);
    expect(out[0].nao_lidas).toBe(2);
    expect(out[0].ultima?.id).toBe('n');
  });
  it('INSERT enviado (portal/IA): vira a última, NÃO soma não lida e atualiza o canal', () => {
    const out = aplicarMensagemNoResumo([resumo('551', { nao_lidas: 1 })],
      linha('o', { wa_id: '551', direction: 'out', created_at: '2026-09-13T12:00:00Z', ...( { origin: 'ia' } as object) }), true)!;
    expect(out[0].nao_lidas).toBe(1);
    expect(out[0].ultima?.id).toBe('o');
    expect(out[0].canal).toBe('ia');
  });
  it('UPDATE (✓✓ chegou) na última troca a linha sem somar; em linha antiga não mexe', () => {
    const antes = [resumo('551', { nao_lidas: 1, ultima: linha('u', { wa_id: '551', direction: 'out', created_at: '2026-09-13T10:00:00Z' }) })];
    const out = aplicarMensagemNoResumo(antes, linha('u', { wa_id: '551', direction: 'out', created_at: '2026-09-13T10:00:00Z', delivery_status: 'read' }), false)!;
    expect(out[0].nao_lidas).toBe(1);
    expect(out[0].ultima?.delivery_status).toBe('read');
    const mesma = aplicarMensagemNoResumo(out, linha('antiga', { wa_id: '551', direction: 'out', created_at: '2026-09-13T08:00:00Z', delivery_status: 'read' }), false);
    expect(mesma).toBe(out);
  });
  it('conversa NOVA (número que nunca apareceu) entra no topo com 1 não lida', () => {
    const out = aplicarMensagemNoResumo([resumo('551')], linha('z', { wa_id: '999', direction: 'in', created_at: '2026-09-13T12:00:00Z', ...( { profile_name: 'Zé' } as object) }), true)!;
    expect(out).toHaveLength(2);
    expect(out[0].wa_id).toBe('999');
    expect(out[0].nao_lidas).toBe(1);
    expect(out[0].nome).toBe('Zé');
  });
});

describe('a aba e o badge usam o resumo do banco, com fallback', () => {
  it('a lista vem de whatsapp_conversas e o caminho antigo continua como fallback', () => {
    expect(fonte).toContain("supa.rpc('whatsapp_conversas', { p_desde: desde })");
    expect(fonte).toContain('if(!ehFuncaoAusente(e)){');
    expect(fonte).toContain('return loadTudo(dias);');
  });
  it('o badge do menu conta no banco (whatsapp_nao_lidas) e cai no navegador se a função faltar', () => {
    expect(fonte).toContain("supa.rpc('whatsapp_nao_lidas', { p_desde: desde })");
    expect(fonte).toContain('contarNoBanco().catch(() => contarNoNavegador())');
  });
  it('o nome do lead vem por leads_por_telefone (índice), com o ILIKE de fallback', () => {
    expect(fonte).toContain("supa.rpc('leads_por_telefone', { p_sufixos: lote })");
  });
  it('enviar NÃO recarrega os 90 dias: só o que mudou há pouco', () => {
    // O `load()` sem argumento depois do envio baixava tudo de novo A CADA
    // mensagem. Os dois envios (texto e template) pedem `load(1)`.
    // Só os envios DA ABA (os da tela de Leads não recarregam lista nenhuma).
    const aba = fonte.slice(fonte.indexOf('const WhatsAppTab = () => {'));
    const envios = aba.split("fetch('/api/whatsapp/send', {").slice(1)
      .filter(t => t.indexOf('setSending(false); setSendStage') > 0);
    expect(envios.length).toBe(2);
    for (const trecho of envios) {
      const ate = trecho.indexOf('setSending(false); setSendStage');
      expect(trecho.slice(0, ate)).not.toMatch(/\bload\(\);/);
      expect(trecho.slice(0, ate)).toContain('load(1)');
    }
  });
  it('o status de entrega chega por realtime (UPDATE), não só pelo poll', () => {
    expect(fonte).toContain("{ event:'UPDATE', schema:'public', table:'whatsapp_messages' }");
  });
});
