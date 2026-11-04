// Portal › Orçamentos (2026-11-04, pedido do usuário: "como vejo o que foi
// quotado?" + selo de lista enviada à loja + "R$ 301,4").
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lojaItensDe } from '@/lib/orcamentoModelo';

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const portal = ler('public/portal/app.jsx');
const wizard = ler('app/orcamento-ia/QuoteWizard.tsx');
const pipeline = ler('lib/services/pipeline.ts');

type Fn = (...a: unknown[]) => unknown;
let fmtValorOrc: Fn, numBR: Fn, servicosDoOrcamento: Fn, envioLojaDe: Fn;

beforeAll(() => {
  const ini = portal.indexOf('// [teste:orc-inicio]');
  const fim = portal.indexOf('// [teste:orc-fim]');
  expect(ini).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(ini);
  const bloco = portal.slice(ini, fim);
  expect(bloco).not.toMatch(/<[A-Za-z]/); // JSX aqui faria o arquivo virar "skipped"
  const r = new Function(`${bloco}; return { fmtValorOrc, numBR, servicosDoOrcamento, envioLojaDe };`)() as Record<string, Fn>;
  ({ fmtValorOrc, numBR, servicosDoOrcamento, envioLojaDe } = r);
});

describe('valor da tabela', () => {
  it('sempre duas casas', () => {
    expect(fmtValorOrc(301.4)).toBe('R$ 301,40');
    expect(fmtValorOrc(34500)).toBe('R$ 34.500,00');
    expect(fmtValorOrc(null)).toBe('—');
    expect(fmtValorOrc(undefined)).toBe('—');
  });
  it('"R$" não quebra a linha sozinho', () => {
    expect(portal).toMatch(/fontWeight:700, whiteSpace:'nowrap' \}\}>\{fmtValorOrc\(o\.price\)\}/);
  });
  it('lê o texto digitado no app', () => {
    expect(numBR('1.616,00')).toBe(1616);
    expect(numBR('35')).toBe(35);
    expect(numBR('12.5')).toBe(12.5);
    expect(numBR('1.500')).toBe(1500);
    expect(numBR('')).toBeNull();
  });
});

describe('o que foi orçado', () => {
  it('serviços com itens e subtotal', () => {
    const s = servicosDoOrcamento({
      servicos: [{ tipo: 'Pintura interna', areaM2: '40', itens: [
        { servico: 'Látex 2 demãos', unidade: 'm2', quantidade: '40', valorUnitario: '18,50' },
        { servico: '', quantidade: '1' },
      ] }],
    }) as { titulo: string; itens: { subtotal: number; unidade: string }[] }[];
    expect(s).toHaveLength(1);
    expect(s[0].titulo).toBe('Pintura interna');
    expect(s[0].itens).toHaveLength(1);
    expect(s[0].itens[0].subtotal).toBe(740);
    expect(s[0].itens[0].unidade).toBe('m²');
  });
  it('formatos antigos não somem', () => {
    const soltos = servicosDoOrcamento({ serviceType: 'Fachada', servicos: [{ servico: 'Textura', valorUnitario: '10', quantidade: '2' }] }) as { titulo: string }[];
    expect(soltos[0].titulo).toBe('Fachada');
    const vanilla = servicosDoOrcamento({ itens: [{ desc: 'Mão de obra', valor: 500 }] }) as { itens: { subtotal: number }[] }[];
    expect(vanilla[0].itens[0].subtotal).toBe(500);
    expect(servicosDoOrcamento(null)).toEqual([]);
  });
});

describe('lista enviada à loja', () => {
  it('portal e app leem a mesma marca', () => {
    const qd = { lojaItens: { enviado_em: '2026-11-04T12:00:00Z', conversation_id: 'a_b' } };
    expect(envioLojaDe(qd)).toEqual({ enviadoEm: '2026-11-04T12:00:00Z', conversationId: 'a_b' });
    expect(lojaItensDe(qd)).toEqual({ enviado_em: '2026-11-04T12:00:00Z', conversation_id: 'a_b' });
    expect(envioLojaDe({})).toBeNull();
    expect(lojaItensDe({ lojaItens: { conversation_id: 'x' } })).toBeNull();
  });
  it('o app grava a marca depois de enviar, e quem gravar por último não a perde', () => {
    expect(wizard).toMatch(/envioLojaRef\.current = \{ enviado_em: new Date\(\)\.toISOString\(\), conversation_id: convId \}/);
    expect(wizard).toMatch(/lojaItens: envioLojaRef\.current/);
    expect(wizard).toMatch(/marcarNoOrcamento\(quoteId\)/);
    expect(pipeline).toMatch(/if \(envio && !lojaItensDe\(qd\)\) qd\.lojaItens = envio;/);
  });
  it('o atalho abre a conversa em Chats 3-Way', () => {
    expect(portal).toMatch(/addEventListener\('portal:abrir-chat', onAbrir\)/);
    expect(portal).toMatch(/const onAbrir = \(\) => setPage\('chats'\)/);
  });
});
