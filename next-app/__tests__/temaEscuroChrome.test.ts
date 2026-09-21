// A barra de cima, a de baixo, o topo da Loja e o cabeçalho do Perfil são
// ESCUROS nos dois temas (usam `--color-ink-fixed`, que não inverte). O texto
// em cima deles precisa do par: `--color-white-fixed`.
//
// Por que isso virou teste (07/09/2026): `text-white` do Tailwind compila pra
// `var(--color-white)` — e esse token INVERTE, porque também é a superfície
// dos cards. No modo escuro o logo "QueroUmaCor" e o "Loja Cali Colors"
// viravam texto escuro sobre fundo escuro e sumiam da tela.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..');
const CHROME = [
  'components/TopNav.tsx',
  'components/BottomNav.tsx',
  'app/perfil/ProfileHeader.tsx',
  'app/loja/ProductsList.tsx',
  'app/loja/StoreSelector.tsx',
];

describe('texto sobre o chrome escuro', () => {
  it('o token que não inverte existe', () => {
    const css = readFileSync(join(RAIZ, 'app/globals.css'), 'utf8');
    expect(css).toContain('--color-white-fixed: #ffffff');
    // E não pode ser redefinido no dark — se for, o problema volta inteiro.
    const dark = css.slice(css.indexOf(":root[data-theme='dark']"));
    expect(dark).not.toContain('--color-white-fixed');
  });

  it('nenhum arquivo de chrome usa `text-white` (o que inverte)', () => {
    const culpados = CHROME.filter((f) =>
      /\btext-white\b/.test(readFileSync(join(RAIZ, f), 'utf8')),
    );
    expect(culpados).toEqual([]);
  });

  it('nenhum usa bg-white/N (mesmo token, mesma inversão)', () => {
    const culpados = CHROME.filter((f) =>
      /\bbg-white\/\d/.test(readFileSync(join(RAIZ, f), 'utf8')),
    );
    expect(culpados).toEqual([]);
  });
});
