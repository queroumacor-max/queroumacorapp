import { describe, it, expect } from 'vitest';
import { mascararTelefones } from '@/lib/api/_services/whatsapp';

// Codex no #412: o log de falha do Dualhook só mascarava dígitos CONTÍGUOS;
// telefone formatado ecoado pelo upstream passava inteiro.
describe('mascararTelefones', () => {
  it('mascara telefone contíguo e formatado, mantendo os 4 últimos', () => {
    expect(mascararTelefones('to 5511959765031')).toBe('to *********5031');
    expect(mascararTelefones('to +55 11 95976-5031 falhou')).toBe('to *********5031 falhou');
    expect(mascararTelefones('(11) 95976-5031')).toBe('*******5031');
  });
  it('não toca em código de erro curto nem em texto', () => {
    expect(mascararTelefones('{"code":131047,"message":"Re-engagement"}')).toBe(
      '{"code":131047,"message":"Re-engagement"}',
    );
    expect(mascararTelefones('sem numero aqui')).toBe('sem numero aqui');
  });
});
