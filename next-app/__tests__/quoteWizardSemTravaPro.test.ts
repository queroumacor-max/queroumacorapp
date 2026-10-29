import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Orçamento é freemium pra todos: a tela não pode voltar a barrar quem não é
// PRO (relato de 29/10: conta grátis via "Orçamento IA é PRO").
describe('QuoteWizard sem trava de PRO', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'orcamento-ia', 'QuoteWizard.tsx'), 'utf8');
  it('não mostra mais "Orçamento IA é PRO"', () => {
    expect(src).not.toContain('Orçamento IA é PRO');
    expect(src).not.toMatch(/canSeeProFeature/);
  });
});
