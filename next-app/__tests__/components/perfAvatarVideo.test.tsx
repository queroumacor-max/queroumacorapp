// @vitest-environment jsdom
//
// Desempenho do feed (2026-11-06): avatar do "Seu story" sem esperar o perfil
// e vídeo que não mostra ▶ enquanto só está carregando.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { guardarAvatar, lerAvatarGuardado } from '@/lib/avatarCache';

const perfil = { valor: { profile: null as Record<string, unknown> | null, loading: true } };
vi.mock('@/lib/publicacaoFila', () => ({ usePublicacao: () => ({ status: 'ocioso' }), tentarDeNovo: () => {} }));
vi.mock('@/lib/hooks/useStories', () => ({ useStories: () => ({ groups: [], loading: false }) }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/hooks/useProfile', () => ({ useProfile: () => perfil.valor }));
vi.mock('@/components/StoryViewer', () => ({ StoryViewer: () => null }));

import { StoriesCarousel } from '@/components/StoriesCarousel';
import { PostMedia } from '@/app/feed/PostMedia';

afterEach(() => {
  cleanup();
  localStorage.clear();
  perfil.valor = { profile: null, loading: true };
});

describe('avatarCache', () => {
  it('guarda por conta, só https, e apaga quando a foto sai', () => {
    guardarAvatar('u1', 'https://x/a.jpg');
    expect(lerAvatarGuardado('u1')).toBe('https://x/a.jpg');
    expect(lerAvatarGuardado('u2')).toBeNull();
    guardarAvatar('u1', 'javascript:alert(1)');
    expect(lerAvatarGuardado('u1')).toBeNull();
    guardarAvatar('u1', 'https://x/b.jpg');
    guardarAvatar('u1', null);
    expect(lerAvatarGuardado('u1')).toBeNull();
    expect(lerAvatarGuardado(null)).toBeNull();
  });
});

describe('"Seu story" não espera o perfil', () => {
  it('perfil carregando → usa o avatar guardado, eager e redimensionado', () => {
    guardarAvatar('u1', 'https://abc.supabase.co/storage/v1/object/public/avatars/u1/a.png');
    const { container } = render(<StoriesCarousel followingIds={[]} />);
    const img = container.querySelector('[aria-label="Criar story"] img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('src')).toContain('/cdn-cgi/image/w=56');
  });

  it('perfil chegou sem foto → some a guardada e o aparelho esquece', () => {
    guardarAvatar('u1', 'https://x/velha.jpg');
    perfil.valor = { profile: { avatar_url: null, tag: 'eu' }, loading: false };
    const { container } = render(<StoriesCarousel followingIds={[]} />);
    expect(container.querySelector('[aria-label="Criar story"] img')).toBeNull();
    expect(lerAvatarGuardado('u1')).toBeNull();
  });

  it('perfil chegou → vale a foto do perfil e ela é guardada', () => {
    guardarAvatar('u1', 'https://x/velha.jpg');
    perfil.valor = { profile: { avatar_url: 'https://x/nova.jpg', tag: 'eu' }, loading: false };
    const { container } = render(<StoriesCarousel followingIds={[]} />);
    expect(container.querySelector('img[src="https://x/nova.jpg"]')).toBeTruthy();
    expect(lerAvatarGuardado('u1')).toBe('https://x/nova.jpg');
  });
});

describe('vídeo do feed', () => {
  type Cb = (e: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
  let observers: Array<{ cb: Cb; opts?: IntersectionObserverInit }> = [];
  let playResult: () => Promise<void>;
  beforeEach(() => {
    observers = [];
    class FakeIO {
      cb: Cb; opts?: IntersectionObserverInit;
      constructor(cb: Cb, opts?: IntersectionObserverInit) { this.cb = cb; this.opts = opts; observers.push(this); }
      observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', FakeIO);
    playResult = () => Promise.resolve();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => true });
    HTMLMediaElement.prototype.play = function () { return playResult(); };
    HTMLMediaElement.prototype.pause = function () {};
  });

  const montar = () =>
    render(<PostMedia url="https://x/v.mp4" mediaType="video" muted onToggleMute={() => {}} />);

  it('nasce com poster vazio: a WebView nunca desenha o ▶ cinza do sistema', () => {
    const { container } = montar();
    const poster = container.querySelector('video')!.getAttribute('poster') ?? '';
    expect(poster.startsWith('data:image/gif;base64,')).toBe(true);
  });

  it('entrou na tela → spinner, nunca o ▶ enquanto carrega', async () => {
    const { container } = montar();
    expect(container.querySelector('[aria-label="Tocar vídeo"]')).toBeNull();
    const play = observers.find((o) => !o.opts?.rootMargin)!;
    await act(async () => play.cb([{ isIntersecting: true, intersectionRatio: 0.9 }]));
    expect(container.querySelector('.video-carregando')).toBeTruthy();
    expect(container.querySelector('[aria-label="Tocar vídeo"]')).toBeNull();
  });

  it('autoplay recusado → aparece o ▶', async () => {
    playResult = () => Promise.reject(new Error('NotAllowed'));
    const { container } = montar();
    const play = observers.find((o) => !o.opts?.rootMargin)!;
    await act(async () => play.cb([{ isIntersecting: true, intersectionRatio: 0.9 }]));
    expect(container.querySelector('[aria-label="Tocar vídeo"]')).toBeTruthy();
    expect(container.querySelector('.video-carregando')).toBeNull();
  });

  it('chegando perto da tela, começa a baixar (preload=auto)', async () => {
    const { container } = montar();
    const v = container.querySelector('video')!;
    expect(v.getAttribute('preload')).toBe('metadata');
    const perto = observers.find((o) => o.opts?.rootMargin)!;
    await act(async () => perto.cb([{ isIntersecting: true, intersectionRatio: 0 }]));
    expect(v.preload).toBe('auto');
  });
});
