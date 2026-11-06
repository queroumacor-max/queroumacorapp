// O sino do TopNav ia pra fora da tela no /notificacoes (print de 06/11):
// seta de voltar + selo ADMIN + logo que não encolhia. Trava o conserto.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const nav = readFileSync(join(process.cwd(), 'components/TopNav.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

describe('TopNav não empurra o sino pra fora', () => {
  it('a logo é quem encolhe (flex-1 + min-w-0 + container)', () => {
    expect(nav).toMatch(/className="topnav-logo flex-1 min-w-0 overflow-hidden/);
    expect(nav).toContain('className="topnav-logo-txt"');
  });
  it('sino e grupo da direita não encolhem', () => {
    expect(nav).toMatch(/relative w-10 h-10 shrink-0/);
    expect(nav).toContain('gap-1.5 shrink-0');
  });
  it('a fonte da logo cede pela largura do container, sem passar do tamanho antigo', () => {
    expect(css).toMatch(/\.topnav-logo\s*\{\s*container-type:\s*inline-size/);
    expect(css).toContain('min(clamp(13px, 4.2vw, 21px), calc(100cqw / 11.8))');
  });
});
