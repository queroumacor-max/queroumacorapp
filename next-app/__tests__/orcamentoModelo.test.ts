import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acharModelo, ehModelo, formularioDeQuoteData, lerReabertura } from '@/lib/orcamentoModelo';

const gravado = {
  numero: '12/2026',
  clientName: 'Maria Silva',
  clientPhone: '11999990000',
  cliente: { rua: 'R. A, 1', bairro: 'Centro', complemento: '', cidade: 'Guarulhos', uf: 'SP', cep: '07000-000', lixo: 1 },
  visitaTecnica: '2026-09-30T09:00',
  profCnpj: '00.000.000/0001-00',
  price: '16.246,00',
  desconto: '10%',
  pagamento: ['PIX', 3, 'Cartão'],
  chavePix: 'chave@pix',
  includeMaterial: false,
  laudoTecnico: 'Parede com trincas.',
  servicos: [{ tipo: 'Pintura externa', itens: [{ nome: 'Selador', quantidade: '200', valor: '7,28' }] }],
  modelo: true,
};

describe('formularioDeQuoteData', () => {
  it('editar: devolve tudo, inclusive cliente e número', () => {
    const f = formularioDeQuoteData(gravado, 'editar');
    expect(f.numero).toBe('12/2026');
    expect(f.clientName).toBe('Maria Silva');
    expect(f.cliente).toEqual({ rua: 'R. A, 1', bairro: 'Centro', complemento: '', cidade: 'Guarulhos', uf: 'SP', cep: '07000-000' });
    expect(f.price).toBe('16.246,00');
    expect(f.includeMaterial).toBe(false);
  });

  it('duplicar: tira cliente, endereço, visita e número — mantém preços e textos', () => {
    const f = formularioDeQuoteData(gravado, 'duplicar');
    expect(f.numero).toBeUndefined();
    expect(f.clientName).toBeUndefined();
    expect(f.clientPhone).toBeUndefined();
    expect(f.cliente).toBeUndefined();
    expect(f.visitaTecnica).toBeUndefined();
    expect(f.price).toBe('16.246,00');
    expect(f.desconto).toBe('10%');
    expect(f.laudoTecnico).toBe('Parede com trincas.');
    expect(f.profCnpj).toBe('00.000.000/0001-00');
  });

  it('filtra tipo errado (pagamento só string) e ignora jsonb vazio/inválido', () => {
    expect(formularioDeQuoteData(gravado, 'duplicar').pagamento).toEqual(['PIX', 'Cartão']);
    expect(formularioDeQuoteData(null, 'editar')).toEqual({});
    expect(formularioDeQuoteData([1, 2], 'editar')).toEqual({});
  });

  it('não vaza a marca de modelo pro formulário', () => {
    expect('modelo' in formularioDeQuoteData(gravado, 'editar')).toBe(false);
  });
});

describe('modelo', () => {
  it('ehModelo só com true de verdade', () => {
    expect(ehModelo({ modelo: true })).toBe(true);
    expect(ehModelo({ modelo: 'true' })).toBe(false);
    expect(ehModelo(null)).toBe(false);
  });
  it('acharModelo pega o primeiro marcado', () => {
    const qs = [{ id: 'a', quote_data: {} }, { id: 'b', quote_data: { modelo: true } }];
    expect(acharModelo(qs)?.id).toBe('b');
    expect(acharModelo([{ id: 'a', quote_data: {} }])).toBeNull();
  });
});

describe('lerReabertura', () => {
  it('aceita uuid e normaliza o modo', () => {
    const id = '3f2b1c9e-8d7a-4e6f-9a1b-2c3d4e5f6a7b';
    expect(lerReabertura(id, 'editar')).toEqual({ baseId: id, modo: 'editar' });
    expect(lerReabertura(id, 'qualquer')).toEqual({ baseId: id, modo: 'duplicar' });
  });
  it('recusa id ausente, lista ou com caractere estranho', () => {
    expect(lerReabertura(undefined, 'editar')).toBeNull();
    expect(lerReabertura(['a'], 'editar')).toBeNull();
    expect(lerReabertura('../x', 'editar')).toBeNull();
  });
});

describe('fiação', () => {
  const wizard = readFileSync(join(__dirname, '../app/orcamento-ia/QuoteWizard.tsx'), 'utf8');
  it('"Gravar" de novo ATUALIZA o mesmo orçamento em vez de criar outro', () => {
    expect(wizard).toMatch(/if \(savedQuoteId && user\?\.id\) \{\s*await updateQuoteContent\(savedQuoteId/);
  });
  it('updateQuoteContent confere linhas afetadas e preserva o modelo', () => {
    const svc = readFileSync(join(__dirname, '../lib/services/pipeline.ts'), 'utf8');
    const corpo = svc.slice(svc.indexOf('export async function updateQuoteContent'), svc.indexOf('export async function setQuoteModelo'));
    expect(corpo).toContain(".select('id')");
    expect(corpo).toContain('data.length === 0');
    expect(corpo).toContain('modelo: true');
  });
});
