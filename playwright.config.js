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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
