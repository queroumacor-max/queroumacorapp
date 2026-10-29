import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// O selo GRÁTIS, no app com o plugin de compras, abre o paywall direto
// (uma tela só). No site segue indo pra /pro. O data-tour é do tour guiado.
describe('TopNav: selo GRÁTIS abre o paywall', () => {
  const src = readFileSync(join(__dirname, '..', 'components', 'TopNav.tsx'), 'utf8');
  it('abre os planos quando GRÁTIS e há compras no app', () => {
    expect(src).toMatch(/badge === 'GRÁTIS' && comprasNoApp[\s\S]*?abrirPaywall\('planos'\)/);
    expect(src).toContain('isPurchasesAvailable');
  });
  it('mantém o link /pro e o alvo do tour', () => {
    expect(src).toContain('href="/pro"');
    expect(src).toContain('data-tour="nav-plano"');
  });
});
