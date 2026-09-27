import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// O confirm é aberto de dentro do BottomSheet (ex.: "Cancelar convite" na
// Gestão de Obras). Se o z-index do Dialog for menor que o do sheet, o
// diálogo aparece ATRÁS do modal atual.
const z = (arquivo: string, trecho: RegExp) => {
  const src = readFileSync(join(__dirname, '..', 'components', arquivo), 'utf8');
  const m = src.match(trecho);
  if (!m) throw new Error(`z-index não encontrado em ${arquivo}`);
  return Number(m[1]);
};

describe('Dialog por cima do BottomSheet', () => {
  it('z-index do Dialog é maior que o do BottomSheet', () => {
    const sheet = z('BottomSheet.tsx', /fixed inset-0 z-\[(\d+)\]/);
    const dialog = z('Dialog.tsx', /fixed inset-0 z-\[(\d+)\]/);
    expect(dialog).toBeGreaterThan(sheet);
  });
  it('toast continua acima do Dialog', () => {
    const dialog = z('Dialog.tsx', /fixed inset-0 z-\[(\d+)\]/);
    const toast = z('ToastViewport.tsx', /z-\[(\d+)\]/);
    expect(toast).toBeGreaterThan(dialog);
  });
});
