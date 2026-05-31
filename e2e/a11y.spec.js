// Acessibilidade via axe-core. Cada rota é uma `test()` separada pra
// isolar o relatório de violations. Tags wcag2a + wcag2aa cobrem o nível
// mínimo (LGPD/WCAG 2.1 AA é o padrão Brasil pra app público).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = ['/', '/login', '/info'];

test.describe('a11y (axe-core)', () => {
  for (const path of ROUTES) {
    test(`sem violations WCAG 2 A/AA em ${path}`, async ({ page }) => {
      await page.goto(path);
      // Aguarda app.js bootar (Modules é o sinal de boot completo).
      await page.waitForFunction(
        () => typeof window.Modules === 'object' && window.Modules !== null,
        { timeout: 15000 },
      ).catch(() => {
        // /login e /info podem não carregar app.js completo; segue mesmo assim.
      });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();

      expect(results.violations, `Violations: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    });
  }
});
