import { describe, expect, it } from 'vitest';
import { calcularFrete, lerNumero } from '@/lib/frete';

describe('calcularFrete', () => {
  it('ida e volta: km × 2, litros = km ÷ consumo, custo = litros × preço', () => {
    const r = calcularFrete({ kmTrajeto: 25, idaEVolta: true, viagens: 1, kmPorLitro: 10, precoLitro: 6 });
    expect(r).toEqual({
      kmTotal: 50, litros: 5, custoCombustivel: 30, custoExtras: 0,
      custoTotal: 30, custoPorKm: 0.6, custoPorViagem: 30,
    });
  });

  it('só ida e várias viagens, com pedágio por viagem', () => {
    const r = calcularFrete({ kmTrajeto: 40, idaEVolta: false, viagens: 3, kmPorLitro: 8, precoLitro: 6.19, extrasPorViagem: 12.5 });
    expect(r?.kmTotal).toBe(120);
    expect(r?.litros).toBe(15);
    expect(r?.custoCombustivel).toBe(92.85);
    expect(r?.custoExtras).toBe(37.5);
    expect(r?.custoTotal).toBe(130.35);
    expect(r?.custoPorViagem).toBe(43.45);
  });

  it('dado faltando ou zerado → null (nunca "frete de graça")', () => {
    const base = { kmTrajeto: 10, idaEVolta: true, viagens: 1, kmPorLitro: 10, precoLitro: 6 };
    expect(calcularFrete({ ...base, kmTrajeto: NaN })).toBeNull();
    expect(calcularFrete({ ...base, kmPorLitro: 0 })).toBeNull();
    expect(calcularFrete({ ...base, precoLitro: -1 })).toBeNull();
  });

  it('viagens vazia ou inválida conta como 1', () => {
    const r = calcularFrete({ kmTrajeto: 10, idaEVolta: false, viagens: NaN, kmPorLitro: 10, precoLitro: 5 });
    expect(r?.kmTotal).toBe(10);
  });
});

describe('lerNumero', () => {
  it('aceita vírgula e ponto como decimal', () => {
    expect(lerNumero('6,19')).toBe(6.19);
    expect(lerNumero('6.19')).toBe(6.19);
    expect(lerNumero('1.234,5')).toBe(1234.5);
  });
  it('vazio ou lixo → NaN', () => {
    expect(lerNumero('')).toBeNaN();
    expect(lerNumero('abc')).toBeNaN();
  });
});
