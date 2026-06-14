import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  deltaE,
  nearestColors,
  type ColorCatalogItem,
} from '../../lib/services/colorMatch';

const cat: ColorCatalogItem[] = [
  { id: 'red', name: 'Vermelho', code: '1', price: 10, hex: '#ff0000', image_url: null },
  { id: 'green', name: 'Verde', code: '2', price: 20, hex: '#00ff00', image_url: null },
  { id: 'blue', name: 'Azul', code: '3', price: 30, hex: '#0000ff', image_url: null },
  { id: 'nearred', name: 'Quase vermelho', code: '4', price: 40, hex: '#fe0204', image_url: null },
];

describe('colorMatch', () => {
  it('hexToRgb parses #rrggbb e #rgb', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('not-a-color')).toBeNull();
  });

  it('rgbToHex faz o caminho de volta', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#ff0000');
    expect(rgbToHex({ r: 0, g: 128, b: 255 })).toBe('#0080ff');
  });

  it('deltaE de cores iguais é 0', () => {
    const lab = { L: 50, a: 10, b: -5 };
    expect(deltaE(lab, lab)).toBe(0);
  });

  it('nearestColors ordena por proximidade e respeita o limite', () => {
    const res = nearestColors('#ff0000', cat, 2);
    expect(res).toHaveLength(2);
    // O próprio vermelho primeiro (ΔE 0), depois o "quase vermelho".
    expect(res[0]!.id).toBe('red');
    expect(res[0]!.deltaE).toBe(0);
    expect(res[1]!.id).toBe('nearred');
    // Ordem crescente de ΔE.
    expect(res[0]!.deltaE).toBeLessThanOrEqual(res[1]!.deltaE);
  });

  it('nearestColors com maxDeltaE descarta cores distantes', () => {
    const res = nearestColors('#ff0000', cat, 12, 5);
    // Só vermelho e quase-vermelho ficam abaixo do corte.
    expect(res.map((r) => r.id).sort()).toEqual(['nearred', 'red']);
  });

  it('hex inválido devolve lista vazia', () => {
    expect(nearestColors('xyz', cat, 5)).toEqual([]);
  });
});
