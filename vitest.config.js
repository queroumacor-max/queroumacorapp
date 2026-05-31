// vitest.config.js — restringe escopo aos testes unitários em /tests/.
// E2E (Playwright) vive em /e2e/ e roda via `npm run test:e2e`.
export default {
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**', 'e2e/**', 'dist/**'],
  },
};
