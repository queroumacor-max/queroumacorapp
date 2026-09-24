// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { temRolavelInterno } from '@/components/BottomSheet';

function caixa(overflowY: string, scrollH: number, clientH: number): HTMLDivElement {
  const el = document.createElement('div');
  el.style.overflowY = overflowY;
  Object.defineProperty(el, 'scrollHeight', { value: scrollH });
  Object.defineProperty(el, 'clientHeight', { value: clientH });
  return el;
}

describe('temRolavelInterno (trava de toque do BottomSheet)', () => {
  it('rolável interno com conteúdo sobrando → deixa rolar', () => {
    const corpo = caixa('auto', 500, 500);
    const lista = caixa('auto', 900, 300);
    const item = document.createElement('span');
    lista.appendChild(item);
    corpo.appendChild(lista);
    expect(temRolavelInterno(item, corpo)).toBe(true);
  });

  it('nada rola entre o alvo e o corpo → segura o gesto', () => {
    const corpo = caixa('auto', 500, 500);
    const bloco = caixa('visible', 900, 300);
    const item = document.createElement('span');
    bloco.appendChild(item);
    corpo.appendChild(bloco);
    expect(temRolavelInterno(item, corpo)).toBe(false);
  });
});

describe('barra de rolagem no computador', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
  it('com mouse (pointer: fine) main e sheet mostram a barra', () => {
    const bloco = css.slice(css.indexOf('@media (pointer: fine) {\n  main, .sheet-body'));
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).toMatch(/scrollbar-width:\s*thin/);
    expect(bloco).toMatch(/\.sheet-body::-webkit-scrollbar\s*{\s*display:\s*block/);
  });
  it('o corpo do BottomSheet usa .sheet-body (não .hide-scrollbar)', () => {
    const src = readFileSync(join(__dirname, '../../components/BottomSheet.tsx'), 'utf8');
    expect(src).toContain('className="sheet-body"');
  });
});
