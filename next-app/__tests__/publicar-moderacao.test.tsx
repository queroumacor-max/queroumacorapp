// @vitest-environment jsdom
//
// Teste adversarial: publicar tem que passar por moderação (Gemini) no
// SERVIDOR antes de criar o post — pendência fechada da auditoria de
// negócio 2026-09-16 (achado: publish nunca chamava /api/moderate; só
// reenvio de mídia JÁ na blocklist de hash era barrado, e isso pelo
// trigger do banco, não por aqui — conteúdo NOVO/desconhecido passava
// direto pro feed com status='approved', sem triagem nenhuma).
//
// 2026-09-17: 4 achados do Codex na revisão desta correção (PR #325),
// todos cobertos aqui:
//   1. 429 (rate limit/cota de moderação estourados) tinha que BLOQUEAR
//      publicar, não fail-open — senão o próprio limite anti-abuso virava
//      bypass (estourar de propósito = publicar sem moderação nenhuma).
//   2. Carrossel (2-5 fotos) só moderava a PRIMEIRA — fotos 2-5 furavam.
//   3. Vídeo nunca chamava /api/moderate-video (endpoint existia sem
//      caller nenhum) — todo vídeo publicado ficava sem moderação.
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

const FOTO = (nome = 'p.jpg') => arquivoDe(nome, 500 * 1024, 'image/jpeg');
const VIDEO = () => arquivoDe('v.mp4', 30 * 1024 * 1024, 'video/mp4');

function jsonRes(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as Response;
}

/** Só as chamadas endereçadas a `/api/moderate` (imagem, não vídeo). */
function chamadasDeImagem(): Array<[string, RequestInit]> {
  return moderateFetch.mock.calls.filter(
    (c) => c[0] === '/api/moderate',
  ) as Array<[string, RequestInit]>;
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
  createPost.mockResolvedValue({ id: 'p1' });
  readImageDimensions.mockResolvedValue({ width: 800, height: 600 });
  // Default: aprova qualquer coisa (imagem OU vídeo) — cada teste
  // sobrescreve o que precisa reprovar/negar.
  moderateFetch.mockResolvedValue(jsonRes({ flagged: false, approved: true, status: 'approved' }));
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
    const { result } = montar();
    await result.current.publishAsync({
      files: [FOTO()],
      caption: 'minha legenda',
      mediaType: 'image',
    });

    const chamadas = chamadasDeImagem();
    expect(chamadas).toHaveLength(1);
    const body = JSON.parse(chamadas[0][1].body as string);
    expect(body.mediaUrl).toBe('https://x/p.jpg');
    expect(body.text).toBe('minha legenda');
  });

  it('FAIL-OPEN: Gemini indisponível (503 → res.ok=false) não bloqueia publicar', async () => {
    moderateFetch.mockResolvedValue(jsonRes({ error: 'GEMINI_API_KEY não configurada' }, false, 503));

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

  // Achado do Codex (#325): 429 (rate limit OU cota de moderação
  // estourados) era tratado como `!res.ok` → fail-open — ou seja, dava
  // pra publicar sem moderação nenhuma só de estourar o próprio limite
  // anti-abuso de propósito. 429 tem que BLOQUEAR, não liberar.
  it('FAIL-CLOSED: 429 (rate limit/cota de moderação) BLOQUEIA — não é fail-open', async () => {
    moderateFetch.mockResolvedValue(
      jsonRes({ error: 'Limite de moderação atingido' }, false, 429),
    );

    const { result } = montar();
    await expect(
      result.current.publishAsync({ files: [FOTO()], caption: '', mediaType: 'image' }),
    ).rejects.toThrow(/moderação/i);

    expect(createPost).not.toHaveBeenCalled();
  });

  // Achado do Codex (#325): só a 1ª foto do carrossel era moderada;
  // fotos 2-5 nunca passavam por /api/moderate nem tinham hash gravado.
  describe('carrossel: TODAS as fotos passam por moderação, não só a primeira', () => {
    it('modera cada foto com sua própria URL — a 1ª carrega o caption, as demais não', async () => {
      const { result } = montar();
      await result.current.publishAsync({
        files: [FOTO('a.jpg'), FOTO('b.jpg'), FOTO('c.jpg')],
        caption: 'legenda única',
        mediaType: 'image',
      });

      const chamadas = chamadasDeImagem();
      expect(chamadas).toHaveLength(3);
      const urls = chamadas.map((c) => JSON.parse(c[1].body as string).mediaUrl);
      expect(urls).toEqual(['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg']);
      const textos = chamadas.map((c) => JSON.parse(c[1].body as string).text);
      expect(textos[0]).toBe('legenda única');
      expect(textos[1]).toBeUndefined();
      expect(textos[2]).toBeUndefined();
    });

    it('reprovação em QUALQUER foto do meio/fim do carrossel bloqueia o post inteiro', async () => {
      let chamada = 0;
      moderateFetch.mockImplementation(async (url: string) => {
        if (url !== '/api/moderate') return jsonRes({ status: 'approved' });
        chamada += 1;
        // A 3ª foto (índice 2) é a reprovada — não a primeira.
        if (chamada === 3) return jsonRes({ flagged: true, approved: false, severity: 'hard' });
        return jsonRes({ flagged: false, approved: true });
      });

      const { result } = montar();
      await expect(
        result.current.publishAsync({
          files: [FOTO('a.jpg'), FOTO('b.jpg'), FOTO('c.jpg')],
          caption: '',
          mediaType: 'image',
        }),
      ).rejects.toThrow(/diretrizes da comunidade/);

      expect(createPost).not.toHaveBeenCalled();
      // Parou na 3ª — não continuou verificando fotos depois dela.
      expect(chamadasDeImagem()).toHaveLength(3);
    });
  });

  // Achado do Codex (#325): /api/moderate-video existia sem NENHUM
  // caller — todo vídeo publicado ficava permanentemente sem moderação.
  describe('vídeo: /api/moderate-video roda DEPOIS do insert (precisa do postId)', () => {
    it('vídeo NUNCA chama /api/moderate (endpoint de imagem) — só /api/moderate-video', async () => {
      const { result } = montar();
      await result.current.publishAsync({ files: [VIDEO()], caption: '', mediaType: 'video' });

      expect(chamadasDeImagem()).toHaveLength(0);
      const chamadasVideo = moderateFetch.mock.calls.filter((c) => c[0] === '/api/moderate-video');
      expect(chamadasVideo).toHaveLength(1);
    });

    it('manda o postId (do post recém-criado) e o caption pro moderate-video', async () => {
      createPost.mockResolvedValue({ id: 'post-video-1' });
      const { result } = montar();
      await result.current.publishAsync({
        files: [VIDEO()],
        caption: 'meu vídeo',
        mediaType: 'video',
      });

      const chamadasVideo = moderateFetch.mock.calls.filter((c) => c[0] === '/api/moderate-video');
      const body = JSON.parse(chamadasVideo[0][1].body as string);
      expect(body.postId).toBe('post-video-1');
      expect(body.caption).toBe('meu vídeo');
    });

    it("status:'rejected' bloqueia — publishAsync rejeita (post já foi apagado no servidor)", async () => {
      moderateFetch.mockImplementation(async (url: string) => {
        if (url === '/api/moderate-video') return jsonRes({ status: 'rejected', reasons: ['nudez'] });
        return jsonRes({ status: 'approved' });
      });

      const { result } = montar();
      await expect(
        result.current.publishAsync({ files: [VIDEO()], caption: '', mediaType: 'video' }),
      ).rejects.toThrow(/diretrizes da comunidade/);
    });

    it("status:'pending' (revisão humana) NÃO bloqueia — o post já existe, fica no ar", async () => {
      moderateFetch.mockImplementation(async (url: string) => {
        if (url === '/api/moderate-video') return jsonRes({ status: 'pending', reason: 'vídeo grande' });
        return jsonRes({ status: 'approved' });
      });

      const { result } = montar();
      const post = await result.current.publishAsync({
        files: [VIDEO()],
        caption: '',
        mediaType: 'video',
      });

      expect(post).toEqual({ id: 'p1' });
    });

    it('FAIL-OPEN: moderate-video indisponível (503/rede) não derruba o publish — post já existe', async () => {
      moderateFetch.mockImplementation(async (url: string) => {
        if (url === '/api/moderate-video') throw new TypeError('Failed to fetch');
        return jsonRes({ status: 'approved' });
      });

      const { result } = montar();
      const post = await result.current.publishAsync({
        files: [VIDEO()],
        caption: '',
        mediaType: 'video',
      });

      expect(post).toEqual({ id: 'p1' });
      await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    });
  });
});
