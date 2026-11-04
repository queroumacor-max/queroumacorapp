// Menu de baixo com NOME em cada botão + troca sino ↔ mensagens
// (pedido do usuário, 04/11/2026). Trava a decisão pra ela não voltar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOUR_STEPS } from '@/lib/tour/steps';

const ler = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const bottom = ler('components/BottomNav.tsx');
const top = ler('components/TopNav.tsx');

describe('menu de baixo com legenda', () => {
  it('os 5 botões, na ordem, com os nomes combinados', () => {
    const labels = [...bottom.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels).toEqual(['Início', 'Procurar', 'Loja', 'Mensagens', 'Empresa']);
  });

  it('o nome aparece na tela (não só no aria-label)', () => {
    expect(bottom).toMatch(/\{item\.label\}\s*<\/span>/);
  });

  it('mensagens estão embaixo e o sino não', () => {
    expect(bottom).toContain("href: '/chat'");
    expect(bottom).not.toContain("href: '/notificacoes'");
    expect(bottom).toContain('useUnreadMessageCount');
  });
});

describe('sino de avisos no topo', () => {
  it('o topo leva pros avisos e não mais pro chat', () => {
    expect(top).toContain('href="/notificacoes"');
    expect(top).toContain('data-tour="nav-notif"');
    expect(top).not.toContain('href="/chat"');
    expect(top).toContain('useUnreadNotificationCount');
  });

  it('/chat virou tela-raiz (sem seta de voltar) e /notificacoes ganhou a seta', () => {
    const raiz = top.match(/ROOT_PATHS = new Set\(\[([^\]]+)\]\)/)?.[1] ?? '';
    expect(raiz).toContain("'/chat'");
    expect(raiz).not.toContain("'/notificacoes'");
  });

  it('o tutorial segue a ordem nova (embaixo primeiro, sino depois do perfil)', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(ids.indexOf('chat')).toBeLessThan(ids.indexOf('perfil'));
    expect(ids.indexOf('perfil')).toBeLessThan(ids.indexOf('notificacoes'));
  });
});

describe('"Seu story" chama pra postar (04/11/2026)', () => {
  const sc = ler('components/StoriesCarousel.tsx');
  it('sem story: anel tracejado + "Poste hoje" (sem estrelinha)', () => {
    expect(sc).toContain('story-chamada');
    expect(sc).toContain('Poste hoje');
    expect(sc).not.toContain('Poste hoje ✨');
  });
  it('a animação respeita quem pediu menos movimento', () => {
    const css = ler('app/globals.css');
    expect(css).toMatch(/prefers-reduced-motion[^}]*\.story-chamada\s*\{\s*animation:\s*none/);
  });
});
