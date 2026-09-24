// Splash dos mascotes: a arte é servida CACHE-FIRST pelo sw.js, então trocar
// a imagem exige trocar o NOME do arquivo (senão o aparelho segue com a
// velha). No #383 a arte mudou com a mesma URL e a legenda desenhada na
// imagem antiga ficou por baixo da legenda em texto. Estes testes travam que
// o nome versionado aponta para um arquivo que existe e que o antigo sumiu.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(__dirname, '..');
const fontes = ['components/SplashMascotes.tsx', 'components/AppShell.tsx'];

describe('arte do splash dos mascotes', () => {
  it('toda referência aponta para um arquivo que existe em public/', () => {
    for (const f of fontes) {
      const src = readFileSync(join(raiz, f), 'utf8');
      const refs = src.match(/"\/mascotes-[\w-]+\.webp"/g) ?? [];
      expect(refs.length, f).toBeGreaterThan(0);
      for (const r of refs) {
        expect(existsSync(join(raiz, 'public', r.slice(2, -1))), `${f} → ${r}`).toBe(true);
      }
    }
  });

  it('o nome sem versão (com a arte antiga em cache nos aparelhos) não volta', () => {
    for (const f of fontes) {
      expect(readFileSync(join(raiz, f), 'utf8')).not.toContain('"/mascotes-calicolors.webp"');
    }
    expect(existsSync(join(raiz, 'public/mascotes-calicolors.webp'))).toBe(false);
  });
});
