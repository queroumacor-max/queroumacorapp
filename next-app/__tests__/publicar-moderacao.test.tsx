// @vitest-environment jsdom
//
// Teste adversarial: publicar tem que passar por moderação (Gemini) no
// SERVIDOR antes de criar o post — pendência fechada da auditoria de
// negócio 2026-09-16 (achado: publish nunca chamava /api/moderate; só
// reenvio de mídia JÁ na blocklist de hash era barrado, e isso pelo
// trigger do banco, não por aqui — conteúdo NOVO/desconhecido passava
// direto pro feed com status='approved', sem triagem nenhuma).
//
// Roda o HOOK DE VERDADE (usePublishPost), não uma cópia da lógica —
// mesmo padrão de __tests__/publicar-comprime.test.tsx: teste que não
// falha sem o fix não é teste de regressão.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const uploadMedia = vi.fn();
const createPost = vi.fn();
const compressImage = vi.fn();
const readImageDimensions = vi.fn();
const moderateFetch = vi.fn();

vi.mock('@/lib/services/posts', () => ({
  uploadMedia: (...a: unknown[]) => uploadMedia(...a),
  createPost: (...a: unknown[]) => createPost(...a),
  compressImage: (...a: unknown[]) => compressImage(...a),
  readImageDimensions: (...a: unknown[]) => readImageDimensions(...a),
  COMPRESS_THRESHOLD: 2 * 1024 * 1024,
}));
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' }, emailVerified: true }),
}));
vi.mock('@/lib/native', () => ({ hapticNotify: vi.fn() }));
vi.mock('@/lib/utils/reportFailure', () => ({ reportFailure: vi.fn() }));
vi.mock('@/lib/services/fetchGated', () => ({
  fetchGated: (...a: unknown[]) => moderateFetch(...a),
}));

import { usePublishPost } from '@/lib/hooks/usePublishPost';

function arquivoDe(nome: string, bytes: number, tipo: string): File {
  const f = new File(['x'], nome, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

const FOTO = () => arquivoDe('p.jpg', 500 * 1024, 'image/jpeg');
const VIDEO = () => arquivoDe('v.mp4', 30 * 1024 * 1024, 'video/mp4');

function jsonRes(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
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
  uploadMedia.mockResolvedValue({ url: 'https://x/foto.jpg', mediaHash: 'h' });
  createPost.mockResolvedValue({ id: 'p1' });
  readImageDimensions.mockResolvedValue({ width: 800, height: 600 });
});

describe('publicar: moderação (Gemini) roda no servidor ANTES de criar o post', () => {
  it('conteúdo reprovado (flagged:true) bloqueia — createPost NUNCA é chamado', async () => {
    moderateFetch.mockResolvedValue(jsonRes({ flagged: true, approved: false, severity: 'hard' }));

    const { result } = montar();
    await expect(
      result.current.publishAsync({ files: [FOTO()], caption: 'oi', mediaType: 'image' }),
    ).rejects.toThrow(/diretrizes da comunidade/);

    expect(createPost).not.toHaveBeenCalled();
  });

  it('approved:false (sem flagged explícito) também bloqueia', async () => {
    moderateFetch.mockResolvedValue(jsonRes({ flagged: false, approved: false }));

    const { result } = montar();
    await expect(
      result.current.publishAsync({ files: [FOTO()], caption: '', mediaType: 'image' }),
    ).rejects.toThrow(/diretrizes da comunidade/);

    expect(createPost).not.toHaveBeenCalled();
  });

  it('conteúdo aprovado (flagged:false, approved:true) publica normalmente', async () => {
    moderateFetch.mockResolvedValue(jsonRes({ flagged: false, approved: true, severity: 'none' }));

    const { result } = montar();
    const post = await result.current.publishAsync({
      files: [FOTO()],
      caption: 'obra linda',
      mediaType: 'image',
    });

    expect(post).toEqual({ id: 'p1' });
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it('manda o mediaUrl que o upload devolveu e o caption pro /api/moderate', async () => {
    moderateFetch.mockResolvedValue(jsonRes({ flagged: false, approved: true }));

    const { result } = montar();
    await result.current.publishAsync({
      files: [FOTO()],
      caption: 'minha legenda',
      mediaType: 'image',
    });

    expect(moderateFetch).toHaveBeenCalledTimes(1);
    const [url, init] = moderateFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/moderate');
    const body = JSON.parse(init.body as string);
    expect(body.mediaUrl).toBe('https://x/foto.jpg');
    expect(body.text).toBe('minha legenda');
  });

  it('FAIL-OPEN: Gemini indisponível (503 → res.ok=false) não bloqueia publicar', async () => {
    moderateFetch.mockResolvedValue(jsonRes({ error: 'GEMINI_API_KEY não configurada' }, false));

    const { result } = montar();
    const post = await result.current.publishAsync({
      files: [FOTO()],
      caption: '',
      mediaType: 'image',
    });

    expect(post).toEqual({ id: 'p1' });
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it('FAIL-OPEN: falha de rede (fetchGated rejeita) não bloqueia publicar', async () => {
    moderateFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = montar();
    const post = await result.current.publishAsync({
      files: [FOTO()],
      caption: '',
      mediaType: 'image',
    });

    expect(post).toEqual({ id: 'p1' });
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it('vídeo NUNCA chama /api/moderate (pipeline própria, roda depois do insert)', async () => {
    moderateFetch.mockResolvedValue(jsonRes({ flagged: true, approved: false }));

    const { result } = montar();
    const post = await result.current.publishAsync({
      files: [VIDEO()],
      caption: '',
      mediaType: 'video',
    });

    expect(moderateFetch).not.toHaveBeenCalled();
    expect(post).toEqual({ id: 'p1' });
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
  });
});
