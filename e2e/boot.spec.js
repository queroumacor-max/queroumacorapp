// Smoke E2E: verifica que app.js / shims.js / modules/* carregaram sem
// erro de console e que window.Modules + globals shimados ficaram wireados.
// Roda contra E2E_BASE_URL (default: www.queroumacor.com.br).
import { test, expect } from '@playwright/test';

test('boot: sem ReferenceError no console, window.Modules e globals shimados disponíveis', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if(msg.type() === 'error'){
      const text = msg.text();
      // Ignora 404 de favicon/cors de extensão/erros de Service Worker em preview.
      if(/favicon|extension|chrome-extension|sw\.js/i.test(text)) return;
      consoleErrors.push(`console.error: ${text}`);
    }
  });

  await page.goto('/');
  // Aguarda app.js + shims.js carregarem (defer → executam após HTML parsing).
  await page.waitForFunction(() => typeof window.Modules === 'object' && window.Modules !== null, { timeout: 15000 });

  // Sanity: módulos chave registrados
  const modulesPresent = await page.evaluate(() => ({
    feed: typeof window.Modules.feed === 'object',
    chat: typeof window.Modules.chat === 'object',
    mkt: typeof window.Modules.mkt === 'object',
    nav: typeof window.Modules.nav === 'object',
    info: typeof window.Modules.info === 'object',
    ranking: typeof window.Modules.ranking === 'object',
    pipeline: typeof window.Modules.pipeline === 'object',
  }));
  for(const [name, present] of Object.entries(modulesPresent)){
    expect(present, `Modules.${name} ausente`).toBe(true);
  }

  // Sanity: shims wireram bare globals que HTML inline handlers usam
  const globalsWired = await page.evaluate(() => ({
    showScreen: typeof window.showScreen === 'function',
    loadFeed: typeof window.loadFeed === 'function',
    loadRanking: typeof window.loadRanking === 'function',
    toast: typeof window.toast === 'function',
    escapeHtml: typeof window.escapeHtml === 'function',
    openInfoPage: typeof window.openInfoPage === 'function',
    updateCartBadge: typeof window.updateCartBadge === 'function',
  }));
  for(const [name, wired] of Object.entries(globalsWired)){
    expect(wired, `window.${name} não foi shimado`).toBe(true);
  }

  // window.Utils + window.DB + window.Validators + window.Policies precisam estar lá
  const fundacao = await page.evaluate(() => ({
    Utils: typeof window.Utils === 'object',
    DB: typeof window.DB === 'object',
    Validators: typeof window.Validators === 'object',
    Policies: typeof window.Policies === 'object',
  }));
  for(const [name, present] of Object.entries(fundacao)){
    expect(present, `window.${name} ausente`).toBe(true);
  }

  // Reportar todos os erros de console que sobraram (não deve ter nenhum)
  expect(consoleErrors, `console errors detectados:\n${consoleErrors.join('\n')}`).toEqual([]);
});
