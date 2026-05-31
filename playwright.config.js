// Playwright config — E2E mínimo rodando contra prod (ou preview via env var).
// Sem webServer: o app é estático no Cloudflare Pages, não levantamos local.
// fullyParallel:false pra evitar contention com Supabase (rate limits de auth).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://www.queroumacor.com.br',
  },
  // Cross-browser: cobre os 3 engines (Blink/Gecko/WebKit) + 2 perfis
  // mobile. Mobile-safari pega quirks de iOS Safari (PWA, storage,
  // viewport) que destoam do desktop. Em CI, isso vira 5x o tempo de
  // E2E — use `--project=chromium` pra smoke rápido em PR.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
});
