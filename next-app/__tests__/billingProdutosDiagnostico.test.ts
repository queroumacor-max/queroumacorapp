import { describe, it, expect } from 'vitest';
import { descreverErroDaLoja } from '@/lib/native/purchases';

describe('descreverErroDaLoja', () => {
  it('junta código, código legível, mensagem e erro de baixo', () => {
    const t = descreverErroDaLoja({
      code: '23',
      message: 'There is an issue with your configuration.',
      data: { readableErrorCode: 'CONFIGURATION_ERROR', underlyingErrorMessage: 'None of the products could be fetched' },
    });
    expect(t).toContain('código 23');
    expect(t).toContain('CONFIGURATION_ERROR');
    expect(t).toContain('None of the products could be fetched');
  });
  it('não repete o mesmo texto e aguenta vazio/primitivo', () => {
    expect(descreverErroDaLoja({ message: 'x', data: { message: 'x' } })).toBe('x');
    expect(descreverErroDaLoja(null)).toBe('erro sem detalhe');
    expect(descreverErroDaLoja('falhou')).toBe('falhou');
    expect(descreverErroDaLoja(new Error('carregar produtos: tempo esgotado'))).toContain('tempo esgotado');
  });
});

describe('withTimeout com retorno que não é promessa', () => {
  it('aceita undefined (configure do iOS é CAPPluginReturnNone)', async () => {
    const { withTimeout } = await import('@/lib/native/purchases');
    await expect(withTimeout(undefined as unknown as Promise<void>, 1000, 'configurar')).resolves.toBeUndefined();
  });
});
