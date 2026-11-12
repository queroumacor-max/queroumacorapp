import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Orçamento é freemium pra todos: a tela não pode voltar a BARRAR quem não é
// PRO de criar orçamento (relato de 29/10: conta grátis via "Orçamento IA é
// PRO"). Desde 12/11 o free tem 2 orçamentos/dia COM IA + valores sugeridos e,
// do 3º do dia em diante, entra em MODO MANUAL (sem IA, sem sugestões) — mas
// AINDA CRIA. Então: sem a frase de trava, e nada que impeça criar o orçamento.
describe('QuoteWizard sem trava de PRO (free ainda cria)', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'orcamento-ia', 'QuoteWizard.tsx'), 'utf8');

  it('não mostra mais "Orçamento IA é PRO"', () => {
    expect(src).not.toContain('Orçamento IA é PRO');
  });

  it('não bloqueia a criação pra quem não é PRO (modo manual degrada, não trava)', () => {
    // O "modo manual" só esconde IA/sugestões; o botão Gravar e os serviços
    // continuam disponíveis. Garante que não há early-return barrando não-PRO.
    expect(src).toContain('modoManual');
    expect(src).not.toMatch(/return[^;]*Recurso PRO/);
    expect(src).not.toMatch(/Assine o PRO pra (criar|fazer) orçamento/i);
  });
});
