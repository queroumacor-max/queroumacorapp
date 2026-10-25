// Serviços do orçamento (tile "Orçamento · Crie e envie") — a parte pura.
// O que precisa ficar travado:
//  - o ITEM nasce com valor vazio e a sugestão da tabela do lado;
//  - as somas separam "o que a pessoa preencheu" de "o que a tabela sugere";
//  - um orçamento tem VÁRIOS serviços, cada um com espaço/material/itens;
//  - o que foi gravado em quote_data volta igual, e lixo é descartado.

import { describe, it, expect } from 'vitest';
import type { PriceItem } from '@/lib/services/priceTable';
import {
  alturaDoAcesso,
  areaTotal,
  descreverItem,
  descreverServico,
  detalhesDoServico,
  itemAvulso,
  itemDaTabela,
  novoServico,
  quantidadeDe,
  nomeDoServico,
  resumoDoServico,
  servicoComItem,
  servicosDoQuoteData,
  subtotalDoItem,
  subtotalSugerido,
  temAvulsoSemNome,
  textoDosItensParaLoja,
  tituloDosServicos,
  totaisDoOrcamento,
  totaisDosItens,
  valorUnitarioDe,
} from '@/lib/orcamentoServicos';

function item(over: Partial<PriceItem> = {}): PriceItem {
  return {
    id: 'pt-1',
    sheet_no: 4,
    category: 'Alvenarias e Paredes',
    grupo: 'Látex',
    tipo: 'Acrílico Premium',
    servico: 'Premium Fosco 3 demãos (m²)',
    observacao: null,
    altura: 'ate_3m',
    unidade: 'm2',
    preco_medio: 20.2,
    preco_min: 14.44,
    preco_max: 25.97,
    sort_order: 9,
    ...over,
  };
}

describe('itemDaTabela', () => {
  it('nasce com valor VAZIO e a sugestão (mín/média/máx) do lado', () => {
    const s = itemDaTabela(item(), 'a');
    expect(s.valorUnitario).toBe('');
    expect(s.quantidade).toBe('1');
    expect(s.priceItemId).toBe('pt-1');
    expect(s.unidade).toBe('m2');
    expect(s.sugestao).toEqual({ min: 14.44, medio: 20.2, max: 25.97 });
    expect(s.detalhe).toBe('Látex · Acrílico Premium · até 3 m');
  });

  it('item zerado no PDF (sem valor publicado) não vira sugestão de R$ 0', () => {
    const s = itemDaTabela(item({ preco_medio: 0, preco_min: null, preco_max: null }), 'a');
    expect(s.sugestao).toBeNull();
    expect(subtotalSugerido(s)).toBeNull();
  });

  it('item avulso não tem sugestão nem linha da tabela', () => {
    const s = itemAvulso('Grafite no muro', 'x');
    expect(s.priceItemId).toBeNull();
    expect(s.sugestao).toBeNull();
    expect(s.valorUnitario).toBe('');
  });
});

describe('alturaDoAcesso', () => {
  it('térreo e escada caem em "até 3 m"; andaime e cadeira suspensa em "acima"', () => {
    expect(alturaDoAcesso('Térreo / sem altura')).toBe('ate_3m');
    expect(alturaDoAcesso('Escada (até 3m)')).toBe('ate_3m');
    expect(alturaDoAcesso('Andaime (3-6m)')).toBe('acima_3m');
    expect(alturaDoAcesso('Andaime alto / cadeira suspensa (acima 6m)')).toBe('acima_3m');
    expect(alturaDoAcesso('')).toBeNull();
    expect(alturaDoAcesso(null)).toBeNull();
  });
});

describe('contas por item', () => {
  it('quantidade vazia/inválida vale 1; aceita vírgula', () => {
    const s = itemDaTabela(item(), 'a');
    expect(quantidadeDe(s)).toBe(1);
    expect(quantidadeDe({ ...s, quantidade: '' })).toBe(1);
    expect(quantidadeDe({ ...s, quantidade: 'abc' })).toBe(1);
    expect(quantidadeDe({ ...s, quantidade: '0' })).toBe(1);
    expect(quantidadeDe({ ...s, quantidade: '12,5' })).toBe(12.5);
  });

  it('valor vazio é null (não é zero) e o subtotal também', () => {
    const s = itemDaTabela(item(), 'a');
    expect(valorUnitarioDe(s)).toBeNull();
    expect(subtotalDoItem(s)).toBeNull();
    // A sugestão continua disponível pra mostrar ao lado.
    expect(subtotalSugerido({ ...s, quantidade: '80' })).toBe(1616);
  });

  it('aceita "1.500,50" e "1500.50" no valor unitário (regra do parseBRL)', () => {
    const s = itemDaTabela(item(), 'a');
    expect(valorUnitarioDe({ ...s, valorUnitario: '1.500,50' })).toBe(1500.5);
    expect(valorUnitarioDe({ ...s, valorUnitario: '1500.50' })).toBe(1500.5);
    expect(valorUnitarioDe({ ...s, valorUnitario: 'R$ 22' })).toBe(22);
    expect(subtotalDoItem({ ...s, valorUnitario: '22', quantidade: '80' })).toBe(1760);
  });

  it('subtotal arredonda a centavo (sem 269.70000000000005)', () => {
    const s = itemDaTabela(item(), 'a');
    expect(subtotalDoItem({ ...s, valorUnitario: '0,1', quantidade: '3' })).toBe(0.3);
  });
});

describe('totaisDosItens / totaisDoOrcamento', () => {
  const a = { ...itemDaTabela(item(), 'a'), quantidade: '80', valorUnitario: '22' };
  const b = { ...itemDaTabela(item({ id: 'pt-2', preco_medio: 10 }), 'b'), quantidade: '10' };
  const c = itemAvulso('Retoque', 'c');

  it('separa o preenchido do sugerido e conta o que falta', () => {
    const t = totaisDosItens([a, b, c]);
    expect(t.preenchido).toBe(1760); // só a
    expect(t.sugerido).toBe(1760 + 100); // a (digitado) + b (média 10 × 10); c não tem pista
    expect(t.semValor).toBe(2);
    expect(t.semSugestao).toBe(1);
  });

  it('o total do orçamento soma os itens de TODOS os serviços', () => {
    const s1 = novoServico({ itens: [a] }, 's1');
    const s2 = novoServico({ itens: [b, c] }, 's2');
    expect(totaisDoOrcamento([s1, s2])).toEqual(totaisDosItens([a, b, c]));
  });

  it('lista vazia zera tudo', () => {
    expect(totaisDosItens([])).toEqual({ preenchido: 0, sugerido: 0, semValor: 0, semSugestao: 0 });
    expect(totaisDoOrcamento([])).toEqual({ preenchido: 0, sugerido: 0, semValor: 0, semSugestao: 0 });
  });
});

describe('descreverItem', () => {
  it('sem valor diz "a definir" em vez de inventar número', () => {
    const s = { ...itemDaTabela(item(), 'a'), quantidade: '80' };
    expect(descreverItem(s)).toBe('Premium Fosco 3 demãos (m²) — 80 m² (valor a definir)');
  });

  it('com valor mostra a conta inteira', () => {
    const s = { ...itemDaTabela(item(), 'a'), quantidade: '80', valorUnitario: '22' };
    expect(descreverItem(s)).toBe('Premium Fosco 3 demãos (m²) — 80 m² × R$ 22,00 = R$ 1.760,00');
  });
});

describe('serviços (vários por orçamento)', () => {
  it('novoServico nasce TODO vazio (nada pré-escolhido) e aceita sobrescrita', () => {
    const s = novoServico({}, 'x');
    expect(s.tipo).toBe('');
    expect(s.peDireito).toBe('');
    expect(s.demaos).toBe('');
    expect(s.preparacao).toEqual([]);
    expect(s.itens).toEqual([]);
    expect(detalhesDoServico(s)).toEqual([]); // nada inventado no PDF
    expect(novoServico({ tipo: 'Piso epóxi', acesso: 'Andaime (3-6m)' }, 'y')).toMatchObject({
      tipo: 'Piso epóxi',
      acesso: 'Andaime (3-6m)',
    });
  });

  it('servicoComItem nasce em volta do item e herda acesso/tinta do anterior', () => {
    const primeiro = servicoComItem(itemDaTabela(item(), 'i1'), null, 'a');
    expect(primeiro.itens).toHaveLength(1);
    expect(primeiro.acesso).toBe('');
    // Sem tipo escolhido, o nome do serviço é o do item.
    expect(nomeDoServico(primeiro)).toBe('Premium Fosco 3 demãos (m²)');
    expect(tituloDosServicos([primeiro])).toBe('Premium Fosco 3 demãos (m²)');
    const anterior = { ...primeiro, acesso: 'Andaime (3-6m)', tinta: 'Elastomérica (fachada)', areaM2: '80' };
    const segundo = servicoComItem(itemAvulso('Retoque', 'i2'), anterior, 'b');
    expect(segundo.acesso).toBe('Andaime (3-6m)');
    expect(segundo.tinta).toBe('Elastomérica (fachada)');
    expect(segundo.areaM2).toBe(''); // só acesso e tinta são herdados
    expect(segundo.itens[0]!.servico).toBe('Retoque');
  });

  it('título: um serviço → o tipo; vários → tipos distintos com " + "', () => {
    const a = novoServico({ tipo: 'Pintura interna' }, 'a');
    const b = novoServico({ tipo: 'Pintura externa / fachada' }, 'b');
    const c = novoServico({ tipo: 'Pintura interna' }, 'c'); // repetido não duplica
    expect(tituloDosServicos([a])).toBe('Pintura interna');
    expect(tituloDosServicos([a, b, c])).toBe('Pintura interna + Pintura externa / fachada');
    expect(tituloDosServicos([])).toBe('Orçamento');
  });

  it('área total soma só as informadas; nenhuma → null', () => {
    expect(areaTotal([novoServico({ areaM2: '80' }, 'a'), novoServico({ areaM2: '12,5' }, 'b'), novoServico({}, 'c')])).toBe(92.5);
    expect(areaTotal([novoServico({}, 'a')])).toBeNull();
  });

  it('resumo e detalhes só trazem o que está preenchido', () => {
    const s = novoServico(
      { tipo: 'Pintura interna', areaM2: '80', comodos: '3', tinta: 'PVA (interna)', cor: 'branco gelo', preparacao: ['Selador'] },
      'a',
    );
    expect(resumoDoServico(s)).toBe('Pintura interna · 80 m² · 3 cômodos');
    const d = Object.fromEntries(detalhesDoServico(s));
    expect(d['Tinta']).toBe('PVA (interna) · branco gelo');
    expect(d['Preparação']).toBe('Selador');
    expect(d['Cômodos']).toBe('3');
    // Só a cor, sem tinta: não sai " · branco gelo" solto.
    expect(Object.fromEntries(detalhesDoServico(novoServico({ cor: 'areia' }, 'c')))['Tinta']).toBe('areia');
    // Sem cômodos e sem área, as linhas não aparecem.
    const vazio = Object.fromEntries(detalhesDoServico(novoServico({ comodos: '', areaM2: '' }, 'b')));
    expect(vazio['Cômodos']).toBeUndefined();
    expect(vazio['Área']).toBeUndefined();
  });

  it('descreverServico lista o resumo, os detalhes e os itens', () => {
    const s = novoServico(
      { tipo: 'Pintura interna', areaM2: '80', acesso: 'Térreo / sem altura', itens: [{ ...itemDaTabela(item(), 'i'), quantidade: '80' }] },
      'a',
    );
    const txt = descreverServico(s);
    expect(txt.split('\n')[0]).toBe('Pintura interna · 80 m²');
    expect(txt).toContain('Acesso: Térreo / sem altura');
    expect(txt).toContain('• Premium Fosco 3 demãos (m²) — 80 m² (valor a definir)');
    expect(txt).not.toContain('Área:'); // já está no resumo
  });

  it('temAvulsoSemNome acha o item mudo em qualquer serviço', () => {
    const ok = novoServico({ itens: [itemAvulso('Retoque', 'a')] }, 's1');
    const mudo = novoServico({ itens: [itemAvulso('', 'b')] }, 's2');
    expect(temAvulsoSemNome([ok])).toBe(false);
    expect(temAvulsoSemNome([ok, mudo])).toBe(true);
  });
});

describe('servicosDoQuoteData', () => {
  it('devolve os serviços gravados, com itens, e descarta lixo', () => {
    const s1 = novoServico(
      { tipo: 'Pintura interna', areaM2: '80', itens: [itemDaTabela(item(), 'i1'), { servico: '' } as never, null as never] },
      'a',
    );
    const s2 = novoServico({ tipo: 'Piso epóxi', itens: [] }, 'b');
    const gravado = { servicos: [s1, s2, null, 'texto', { semNada: true }], warranty: '90 dias' };
    const lidos = servicosDoQuoteData(JSON.parse(JSON.stringify(gravado)));
    expect(lidos).toHaveLength(2);
    expect(lidos[0]).toMatchObject({ id: 'a', tipo: 'Pintura interna', areaM2: '80' });
    expect(lidos[0]!.itens).toHaveLength(1);
    expect(lidos[0]!.itens[0]!.sugestao).toEqual({ min: 14.44, medio: 20.2, max: 25.97 });
    expect(lidos[1]).toMatchObject({ id: 'b', tipo: 'Piso epóxi', itens: [] });
  });

  it('formato da 1ª versão (itens direto na lista) vira UM serviço com os campos do topo', () => {
    const gravado = {
      serviceType: 'Pintura interna',
      areaM2: '80',
      paintType: 'PVA (interna)',
      coats: '3',
      prep: ['Selador'],
      access: 'Escada (até 3m)',
      servicos: [
        { ...itemDaTabela(item(), 'i1'), quantidade: '80', valorUnitario: '22' },
        { servico: 'Avulso ok', quantidade: 2, valorUnitario: 150 }, // números viram texto
      ],
    };
    const lidos = servicosDoQuoteData(gravado);
    expect(lidos).toHaveLength(1);
    expect(lidos[0]).toMatchObject({
      tipo: 'Pintura interna',
      areaM2: '80',
      tinta: 'PVA (interna)',
      demaos: '3',
      preparacao: ['Selador'],
      acesso: 'Escada (até 3m)',
    });
    expect(lidos[0]!.itens).toHaveLength(2);
    expect(lidos[0]!.itens[1]).toMatchObject({ servico: 'Avulso ok', quantidade: '2', valorUnitario: '150', unidade: 'unidade' });
    expect(totaisDoOrcamento(lidos).preenchido).toBe(1760 + 300);
  });

  it('quote_data sem a chave, nulo ou só com o formato legado do vanilla → lista vazia', () => {
    expect(servicosDoQuoteData(null)).toEqual([]);
    expect(servicosDoQuoteData({ warranty: 'x' })).toEqual([]);
    expect(servicosDoQuoteData({ servicos: 'não é lista' })).toEqual([]);
    expect(servicosDoQuoteData({ itens: [{ desc: 'legado', valor: 'R$ 1' }] })).toEqual([]);
  });

  it('ida e volta pelo JSON mantém os totais', () => {
    const lista = [
      novoServico({ itens: [{ ...itemDaTabela(item(), 'a'), quantidade: '80', valorUnitario: '22' }] }, 's1'),
      novoServico({ itens: [{ ...itemDaTabela(item({ id: 'pt-2', preco_medio: 10 }), 'b'), quantidade: '10' }] }, 's2'),
    ];
    const volta = servicosDoQuoteData(JSON.parse(JSON.stringify({ servicos: lista })));
    expect(totaisDoOrcamento(volta)).toEqual(totaisDoOrcamento(lista));
  });
});

describe('textoDosItensParaLoja', () => {
  const servico = () =>
    novoServico({
      tipo: 'Pintura interna',
      areaM2: '80',
      tinta: 'Acrílico Premium',
      cor: 'Branco Neve',
      itens: [{ ...itemDaTabela(item(), 'a'), quantidade: '80', valorUnitario: '22,00' }],
    }, 's1');

  it('leva serviço, tinta e item com quantidade — sem preço de mão de obra', () => {
    const t = textoDosItensParaLoja([servico()], { nome: 'Léo Pinturas', cidade: 'Guarulhos', uf: 'SP' });
    expect(t).toContain('Pedido de orçamento de material (sem compromisso)');
    expect(t).toContain('Pintor: Léo Pinturas · Guarulhos/SP');
    expect(t).toContain('Pintura interna · 80 m²');
    expect(t).toContain('Tinta: Acrílico Premium · Branco Neve');
    expect(t).toContain('• Premium Fosco 3 demãos (m²) — 80 m²');
    expect(t).not.toMatch(/R\$/);
  });

  it('nunca leva dado do cliente (a função nem recebe)', () => {
    const t = textoDosItensParaLoja([servico()], { nome: 'Léo' });
    expect(t).not.toMatch(/Cliente|Telefone/);
    expect(t).toContain('Pintor: Léo\n');
  });
});
