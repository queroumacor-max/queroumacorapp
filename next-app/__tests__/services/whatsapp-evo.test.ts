// whatsapp-evo — depois da limpeza de 2026-09-17 (código morto do cliente
// Evolution API), o que sobra no arquivo é só `normalizeWhatsAppTarget`.
import { describe, expect, it } from 'vitest';
import { normalizeWhatsAppTarget } from '../../lib/api/_services/whatsapp-evo';

describe('normalizeWhatsAppTarget', () => {
  it('BR local vira +55 (celular com 9 e fixo)', () => {
    expect(normalizeWhatsAppTarget('11 92072-5935')).toBe('5511920725935'); // celular
    expect(normalizeWhatsAppTarget('(11) 3255-1000')).toBe('551132551000'); // fixo
  });

  it('BR já com DDI passa direto', () => {
    expect(normalizeWhatsAppTarget('5511920725935')).toBe('5511920725935');
    expect(normalizeWhatsAppTarget('+55 (11) 95976-5031')).toBe('5511959765031');
    expect(normalizeWhatsAppTarget('551132551000')).toBe('551132551000');
  });

  it('EUA passa VERBATIM — não ganha 55 na frente (o bug do 502)', () => {
    // +1 650 315-4274: 11 dígitos, mas 3º dígito não é 9 → não é celular BR.
    expect(normalizeWhatsAppTarget('16503154274')).toBe('16503154274');
    expect(normalizeWhatsAppTarget('+1 (650) 315-4274')).toBe('16503154274');
  });

  it('outros países passam verbatim', () => {
    expect(normalizeWhatsAppTarget('351912345678')).toBe('351912345678'); // Portugal
    expect(normalizeWhatsAppTarget('+34 612 345 678')).toBe('34612345678'); // Espanha
    expect(normalizeWhatsAppTarget('818012345678')).toBe('818012345678'); // Japão
  });

  it('lixo e comprimentos impossíveis viram null', () => {
    expect(normalizeWhatsAppTarget('')).toBeNull();
    expect(normalizeWhatsAppTarget('abc')).toBeNull();
    expect(normalizeWhatsAppTarget('12345')).toBeNull(); // curto demais
    expect(normalizeWhatsAppTarget('1234567890123456')).toBeNull(); // 16 dígitos
  });

  it('caso-limite: 11 dígitos começando com 55 NÃO é tratado como BR com DDI', () => {
    // 55 9xxxx-xxxx local (DDD 55 = RS) — 11 dígitos com 9 no 3º → ganha DDI.
    expect(normalizeWhatsAppTarget('55991234567')).toBe('5555991234567');
  });
});
