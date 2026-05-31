// vitest.config.ts — config para os testes unitários do port Next.js.
// Restringe escopo a `__tests__/**` pra não pegar arquivos de outras camadas.
// Usa `jsdom` porque alguns helpers (utils.escapeHtml etc.) podem ser
// chamados em contexto de browser; por enquanto não precisamos de DOM mas
// deixar pronto evita ter que refatorar config quando portarmos componentes.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', '.next/**'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
    },
  },
});
