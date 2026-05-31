// Smoke test: carrega home, encontra o form de login, clica em "Entrar"
// sem preencher e valida que o toast de erro aparece.
// Não tenta logar de fato — não temos credencial de teste configurada.
import { test, expect } from '@playwright/test';

test('login screen mostra toast ao submeter vazio', async ({ page }) => {
  await page.goto('/');

  // O #screen-login é a tela ativa por padrão pra usuário deslogado.
  // Esperamos o input de email aparecer (garante que app.js carregou e o
  // DOM da tela de login está disponível).
  const emailInput = page.locator('#login-email');
  await expect(emailInput).toBeVisible({ timeout: 15000 });

  // Clica em "Entrar" (botão submit do form) sem preencher nada.
  // doLogin() (em head.js) faz: if(!email||!pw){toast('⚠️ Preencha email e senha');return;}
  await page.locator('#screen-login form button[type="submit"]').click();

  // Toast esperado: "⚠️ Preencha email e senha". Casamos por substring pra
  // tolerar pequenas mudanças de cópia (ex.: emoji somido, pontuação).
  await expect(page.getByText(/preencha.*email.*senha/i)).toBeVisible({ timeout: 5000 });
});
