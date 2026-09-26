// O documento do orçamento (layout de referência da LP Decor, 2026-09-08) —
// a parte pura que PDF e prévia HTML compartilham. O que fica travado:
//  - os totais: soma dos itens, desconto em % ou R$, valor total;
//  - o preço digitado abaixo da soma vira desconto (o cliente vê a conta);
//  - endereço/visita/pagamento saem do quote_data sem inventar nada;
//  - orçamento antigo (sem servicos) ainda vira uma linha.

import { describe, it, expect } from 'vitest';
import {
  digitosDoTelefone,
  formatarDataHoraLocal,
  fmtQuantidade,
  linhaDeEndereco,
  montarDocumento,
  parseDesconto,
  rotuloDoProfissional,
} from '@/lib/orcamentoDocumento';
import { itemAvulso, novoServico } from '@/lib/orcamentoServicos';

const perfil = {
  name: 'Andréas Silva',
  business_name: 'LP Decor Pinturas',
  phone: '(11) 95800-3248',
  email: 'lpdecorpinturas@gmail.com',
  city: 'Guaianases',
  state: 'SP',
  address: 'Andréas De SILVA 38',
  bio: 'Somos a LP Decor Pinturas.',
  profession: 'pintor',
  business_logo_url: 'https://x/logo.png',
};

function item(nome: string, qtd: string, valor: string, descricao = '') {
  return { ...itemAvulso(nome, nome), unidade: 'm2', quantidade: qtd, valorUnitario: valor, descricao };
}

const quoteBase = {
  id: 'abcdef12-0000',
  client_name: 'Marcelo e Andreia Wozniak',
  client_phone: '(11) 99596-9143',
  price: 0,
  created_at: '2026-06-01T09:57:00Z',
  quote_data: {
    numero: '13/2026',
    visitaTecnica: '2026-05-25T17:10',
    cliente: { rua: 'Rua Zodumila Domingos Bio, 70', bairro: 'Jd Dos Ipês', complemento: 'Casa', cidade: 'Suzano', uf: 'SP', cep: '08671-010' },
    desconto: '10%',
    laudoTecnico: 'Nenhuma anomalia.',
    description: 'Não inclui andaime.',
    pagamento: ['Dinheiro', 'PIX'],
    chavePix: '36761741000132',
    painter: { cnpj: '36.761.741/0001-32', cpf: '394.717.788-75' },
    servicos: [
      novoServico(
        { local: 'externa', itens: [item('Textura Projetada', '421,4', '50', 'A textura projetada…')] },
        's1',
      ),
      novoServico(
        { tipo: 'Pintura interna', local: 'interna', itens: [item('Empapelamento/Proteção', '228', '10'), item('Sem valor', '5', '')] },
        's2',
      ),
    ],
  },
};

describe('montarDocumento — cabeçalho e cliente', () => {
  it('junta o perfil com o snapshot do orçamento (CNPJ/CPF não existem no perfil)', () => {
    const d = montarDocumento(quoteBase, perfil, { agora: new Date('2026-06-01T09:57:00Z') });
    expect(d.numero).toBe('13/2026');
    expect(d.geradoEm).toBe('01/06/2026 às 06:57'); // Brasília
    expect(d.profissional).toMatchObject({
      nome: 'LP Decor Pinturas',
      rotulo: 'Pintor',
      cnpj: '36.761.741/0001-32',
      cpf: '394.717.788-75',
      telefone: '(11) 95800-3248',
      email: 'lpdecorpinturas@gmail.com',
      logo: 'https://x/logo.png',
      sobre: 'Somos a LP Decor Pinturas.',
    });
    expect(d.profissional.endereco).toBe('Andréas De SILVA 38, Guaianases - SP');
    expect(d.cliente).toEqual({
      nome: 'Marcelo e Andreia Wozniak',
      telefone: '(11) 99596-9143',
      enderecoLinha: 'Rua Zodumila Domingos Bio, 70 - Jd Dos Ipês - Casa - Suzano - SP',
      cep: '08671-010',
    });
    expect(d.visitaTecnica).toBe('25/05/2026 às 17:10');
  });

  it('sem número gravado usa os 8 primeiros do id; sem perfil não quebra', () => {
    const d = montarDocumento({ id: 'abcdef12-9999', quote_data: null }, null);
    expect(d.numero).toBe('abcdef12');
    expect(d.profissional.nome).toBe('Profissional');
    expect(d.aprovacao.aprovarUrl).toBeNull();
  });
});

describe('montarDocumento — serviços e totais', () => {
  it('vários serviços viram grupos com título; um só sai liso', () => {
    const d = montarDocumento(quoteBase, perfil);
    expect(d.grupos.map((g) => g.titulo)).toEqual(['Textura Projetada', 'Pintura interna']);
    expect(d.grupos[0]!.itens[0]).toMatchObject({
      titulo: 'Textura Projetada',
      descricao: 'A textura projetada…',
      rotuloUnidade: 'Valor por m²',
      valorUnitario: 50,
      quantidade: 421.4,
      subtotal: 21070,
    });
    const um = montarDocumento(
      { ...quoteBase, quote_data: { servicos: [quoteBase.quote_data.servicos[0]] } },
      perfil,
    );
    expect(um.grupos[0]!.titulo).toBeNull();
  });

  it('total = soma dos itens com valor; desconto em % sobre a soma; "a definir" marcado', () => {
    const d = montarDocumento(quoteBase, perfil);
    expect(d.totais.totalServicos).toBe(21070 + 2280);
    expect(d.totais.subtotal).toBe(23350);
    expect(d.totais.desconto).toBe(2335);
    expect(d.totais.valorTotal).toBe(21015);
    expect(d.totais.temItemSemValor).toBe(true);
  });

  it('preço gravado ABAIXO da soma, sem desconto digitado, vira desconto', () => {
    const d = montarDocumento(
      { ...quoteBase, price: 20000, quote_data: { ...quoteBase.quote_data, desconto: '' } },
      perfil,
    );
    expect(d.totais.subtotal).toBe(23350);
    expect(d.totais.desconto).toBe(3350);
    expect(d.totais.valorTotal).toBe(20000);
  });

  it('orçamento antigo (sem servicos) vira uma linha com o preço', () => {
    const d = montarDocumento(
      { id: 'x', service_type: 'Pintura interna', description: 'Escopo antigo', price: 2500, quote_data: { paintType: 'PVA' } },
      perfil,
    );
    expect(d.grupos).toHaveLength(1);
    expect(d.grupos[0]!.itens[0]).toMatchObject({ titulo: 'Pintura interna', descricao: 'Escopo antigo', subtotal: 2500 });
    expect(d.totais).toMatchObject({ subtotal: 2500, desconto: 0, valorTotal: 2500 });
  });

  it('formato do vanilla (itens {desc, valor}) também vira linhas', () => {
    const d = montarDocumento(
      { id: 'x', price: 300, quote_data: { itens: [{ desc: 'Mão de obra', valor: 'R$ 300,00' }, { desc: '' }] } },
      perfil,
    );
    expect(d.grupos[0]!.itens).toHaveLength(1);
    expect(d.grupos[0]!.itens[0]!.subtotal).toBe(300);
  });
});

describe('montarDocumento — página 3', () => {
  it('laudo, informações, pagamento, locais e links de aprovação', () => {
    const d = montarDocumento(quoteBase, perfil);
    expect(d.laudoTecnico).toBe('Nenhuma anomalia.');
    expect(d.informacoesAdicionais).toBe('Não inclui andaime.');
    expect(d.pagamento).toEqual({ formas: ['Dinheiro', 'PIX'], chavePix: '36761741000132' });
    expect(d.locais).toEqual([
      { titulo: 'Este serviço será realizado na parte Externa da casa', texto: 'Textura Projetada' },
      { titulo: 'Este serviço será realizado na parte Interna da casa', texto: 'Pintura interna, Empapelamento/Proteção, Sem valor' },
    ]);
    expect(d.aprovacao.aprovarUrl).toMatch(/^https:\/\/wa\.me\/5511958003248\?text=/);
    expect(decodeURIComponent(d.aprovacao.aprovarUrl!)).toContain('Aprovo o orçamento nº 13/2026');
    expect(decodeURIComponent(d.aprovacao.recusarUrl!)).toContain('Não vou seguir');
  });
});

describe('helpers', () => {
  it('parseDesconto: %, R$, vazio, e nunca passa da base', () => {
    expect(parseDesconto('10%', 200)).toBe(20);
    expect(parseDesconto('R$ 1.500,50', 5000)).toBe(1500.5);
    expect(parseDesconto('', 5000)).toBe(0);
    expect(parseDesconto('abc', 5000)).toBe(0);
    expect(parseDesconto('9999', 100)).toBe(100);
  });

  it('formatarDataHoraLocal não passa por fuso', () => {
    expect(formatarDataHoraLocal('2026-05-25T17:10')).toBe('25/05/2026 às 17:10');
    expect(formatarDataHoraLocal('2026-05-25')).toBe('25/05/2026');
    expect(formatarDataHoraLocal('')).toBeNull();
  });

  it('linhaDeEndereco só junta o que tem', () => {
    expect(linhaDeEndereco({ rua: 'Rua A, 1', bairro: '', complemento: '', cidade: 'Suzano', uf: 'SP', cep: '' })).toBe('Rua A, 1 - Suzano - SP');
  });

  it('digitosDoTelefone: BR ganha 55, estrangeiro fica como está', () => {
    expect(digitosDoTelefone('(11) 95800-3248')).toBe('5511958003248');
    expect(digitosDoTelefone('+1 650 315-4274')).toBe('16503154274');
    expect(digitosDoTelefone('')).toBe('');
  });

  it('fmtQuantidade: inteiro com uma casa (228,0), decimal como está', () => {
    expect(fmtQuantidade(228)).toBe('228,0');
    expect(fmtQuantidade(673.34)).toBe('673,34');
  });

  it('rotuloDoProfissional mapeia papel → rótulo', () => {
    expect(rotuloDoProfissional({ profession: 'grafiteiro' })).toBe('Grafiteiro');
    expect(rotuloDoProfissional({ role: 'automotivo' })).toBe('Pintor automotivo');
    expect(rotuloDoProfissional(null)).toBe('Pintor');
  });

  it('logo nunca cai pro avatar_url — sem business_logo_url, fica sem imagem (2026-09-26)', () => {
    const semLogo = { ...perfil, business_logo_url: undefined, avatar_url: 'https://x/foto-de-perfil.jpg' };
    const d = montarDocumento(quoteBase, semLogo);
    expect(d.profissional.logo).toBe('');
  });
});
