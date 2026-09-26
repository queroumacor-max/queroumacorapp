// @vitest-environment jsdom
//
// Publicar: quem modera e publica é o SERVIDOR (2026-09-26).
//
// Histórico: até 2026-09-26 o hook chamava /api/moderate (foto) ANTES de
// criar o post, e /api/moderate-video (vídeo) depois, e gravava o post já
// `approved`. Isso protegia só quem publicava pela tela — gravar direto no
// PostgREST com o próprio token publicava sem moderação nenhuma. Agora o
// post nasce `pending` (o banco força) e o hook só pede a aprovação a
// /api/posts/approve, que modera a partir do que está NO BANCO.
//
// Contrato travado aqui, rodando o HOOK DE VERDADE com a função real
// `aprovarPostNoServidor` (só a rede é falsa):
//   - aprovado → publica;
//   - reprovado / 429 / falha persistente → erro na tela E o post pendente
//     é apagado (nunca fica fantasma no perfil);
//   - soluço de rede → tenta de novo uma vez;
//   - o cliente NUNCA mais chama /api/moderate nem /api/moderate-video
//     pra publicar (a decisão não é dele).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const uploadMedia = vi.fn();
const createPost = vi.fn();
const compressImage = vi.fn();
const readImageDimensions = vi.fn();
const gatedFetch = vi.fn();
const deletePost = vi.fn();

vi.mock('@/lib/services/posts', async () => {
  const real = await vi.importActual<typeof import('@/lib/services/posts')>(
    '@/lib/services/posts',
  );
  return {
    uploadMedia: (...a: unknown[]) => uploadMedia(...a),
    createPost: (...a: unknown[]) => createPost(...a),
    compressImage: (...a: unknown[]) => compressImage(...a),
    readImageDimensions: (...a: unknown[]) => readImageDimensions(...a),
    aprovarPostNoServidor: real.aprovarPostNoServidor,
    COMPRESS_THRESHOLD: 2 * 1024 * 1024,
  };
});
vi.mock('@/lib/services/postInteractions', () => ({
  deletePost: (...a: unknown[]) => deletePost(...a),
}));
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' }, emailVerified: true }),
}));
vi.mock('@/lib/native', () => ({ hapticNotify: vi.fn() }));
vi.mock('@/lib/utils/reportFailure', () => ({ reportFailure: vi.fn() }));
vi.mock('@/lib/services/fetchGated', () => ({
  fetchGated: (...a: unknown[]) => gatedFetch(...a),
}));

import { usePublishPost } from '@/lib/hooks/usePublishPost';

function arquivoDe(nome: string, bytes: number, tipo: string): File {
  const f = new File(['x'], nome, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}
const FOTO = (nome = 'p.jpg') => arquivoDe(nome, 500 * 1024, 'image/jpeg');
const VIDEO = () => arquivoDe('v.mp4', 30 * 1024 * 1024, 'video/mp4');

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function montar() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => usePublishPost(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadMedia.mockImplementation(async (_uid: string, file: File) => ({
    url: `https://x/${file.name}`,
    mediaHash: 'h',
  }));
  createPost.mockResolvedValue({ id: 'p1', media_url: 'https://x/p.jpg' });
  readImageDimensions.mockResolvedValue({ width: 800, height: 600 });
  deletePost.mockResolvedValue({ undoToken: 'p1' });
  gatedFetch.mockResolvedValue(jsonRes({ status: 'approved' }));
});

describe('publicar: o servidor modera e publica', () => {
  it('cria o post e pede aprovação a /api/posts/approve com o id do post', async () => {
    const { result } = montar();
    const post = await result.current.publishAsync({
      files: [FOTO()],
      caption: 'oi',
      mediaType: 'image',
    });
    expect(post).toEqual({ id: 'p1', media_url: 'https://x/p.jpg' });
    expect(gatedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = gatedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/posts/approve');
    expect(JSON.parse(String(init.body))).toEqual({ postId: 'p1' });
    expect(createPost.mock.invocationCallOrder[0]).toBeLessThan(
      gatedFetch.mock.invocationCallOrder[0],
    );
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('o cliente não chama mais /api/moderate nem /api/moderate-video pra publicar', async () => {
    const { result } = montar();
    await result.current.publishAsync({ files: [FOTO('a.jpg'), FOTO('b.jpg')], caption: '', mediaType: 'image' });
    await result.current.publishAsync({ files: [VIDEO()], caption: '', mediaType: 'video' });
    const urls = gatedFetch.mock.calls.map((c) => c[0]);
    expect(urls).not.toContain('/api/moderate');
    expect(urls).not.toContain('/api/moderate-video');
    expect(urls.every((u) => u === '/api/posts/approve')).toBe(true);
  });

  it('reprovado pelo servidor → erro de diretrizes e o post pendente é apagado', async () => {
    gatedFetch.mockResolvedValue(jsonRes({ status: 'rejected', reasons: ['nudez'] }));
    const { result } = montar();
    await expect(
      result.current.publishAsync({ files: [FOTO()], caption: '', mediaType: 'image' }),
    ).rejects.toThrow(/diretrizes da comunidade/);
    expect(deletePost).toHaveBeenCalledWith('u1', 'p1');
  });

  it('429 (limite de moderação) BLOQUEIA — não publica sem moderar', async () => {
    gatedFetch.mockResolvedValue(jsonRes({ error: 'Limite atingido' }, 429));
    const { result } = montar();
    await expect(
      result.current.publishAsync({ files: [FOTO()], caption: '', mediaType: 'image' }),
    ).rejects.toThrow(/Limite atingido/);
    expect(gatedFetch).toHaveBeenCalledTimes(1);
    expect(deletePost).toHaveBeenCalledWith('u1', 'p1');
  });

  it('soluço de rede: tenta de novo uma vez e publica', async () => {
    gatedFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonRes({ status: 'approved' }));
    const { result } = montar();
    await result.current.publishAsync({ files: [FOTO()], caption: '', mediaType: 'image' });
    expect(gatedFetch).toHaveBeenCalledTimes(2);
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('falha persistente (500 duas vezes) → erro visível e o pendente é apagado', async () => {
    gatedFetch.mockResolvedValue(jsonRes({ error: 'erro interno' }, 500));
    const { result } = montar();
    await expect(
      result.current.publishAsync({ files: [FOTO()], caption: '', mediaType: 'image' }),
    ).rejects.toThrow(/Não foi possível concluir a publicação/);
    expect(gatedFetch).toHaveBeenCalledTimes(2);
    expect(deletePost).toHaveBeenCalledWith('u1', 'p1');
  });
});
