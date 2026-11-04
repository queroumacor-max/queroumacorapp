// @vitest-environment jsdom
//
// O anel do "Seu story" durante a publicação em segundo plano (04/11/2026).
// Regra do usuário: SÓ o anel tracejado gira — a foto fica parada (girar o
// círculo inteiro deixaria o rosto de cabeça pra baixo).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const estado = { valor: { status: 'ocioso' } as Record<string, unknown> };
const tentar = vi.fn();
vi.mock('@/lib/publicacaoFila', () => ({
  usePublicacao: () => estado.valor,
  tentarDeNovo: () => tentar(),
}));
vi.mock('@/lib/hooks/useStories', () => ({ useStories: () => ({ groups: [], loading: false }) }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { avatar_url: 'https://x/a.jpg', tag: 'eu' } }),
}));
vi.mock('@/components/StoryViewer', () => ({ StoryViewer: () => null }));

import { StoriesCarousel } from '@/components/StoriesCarousel';

afterEach(() => {
  cleanup();
  tentar.mockReset();
  estado.valor = { status: 'ocioso' };
});

describe('anel do "Seu story" enquanto publica', () => {
  it('enviando: o anel que gira é um elemento separado; a foto não está dentro dele', () => {
    estado.valor = { status: 'enviando', mediaType: 'story', total: 5, enviados: 2, aprovando: false };
    const { container } = render(<StoriesCarousel followingIds={[]} />);
    const anel = container.querySelector('.story-enviando');
    expect(anel).toBeTruthy();
    expect(anel!.querySelector('img')).toBeNull();
    expect(container.querySelector('img[src="https://x/a.jpg"]')).toBeTruthy();
    expect(screen.getByText('Enviando…')).toBeTruthy();
    expect(container.querySelector('.story-chamada')).toBeNull();
  });

  it('falhou: anel vermelho e tocar no círculo tenta de novo', () => {
    estado.valor = { status: 'erro', mediaType: 'story', mensagem: 'x', erro: null };
    const onCreate = vi.fn();
    const { container } = render(<StoriesCarousel followingIds={[]} onCreateStory={onCreate} />);
    expect(container.querySelector('.story-falhou')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/tentar de novo/i));
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('CSS: o anel de envio gira rápido e só ele tem a animação', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toMatch(/\.story-enviando\s*\{[^}]*dashed[^}]*animation:\s*story-chamada-gira\s+1\.2s/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.story-enviando\s*\{\s*animation:\s*story-enviando-pulsa/);
  });
});
