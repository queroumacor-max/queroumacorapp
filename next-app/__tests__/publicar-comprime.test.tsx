// @vitest-environment jsdom
//
// Regressão de 2026-09-04: "Failed to fetch" ao POSTAR, logo depois de gerar
// a legenda com IA na MESMA foto.
//
// A assimetria era a pista: o "Gerar legenda" do Composer comprime acima de
// COMPRESS_THRESHOLD antes de subir; o PUBLICAR subia o arquivo CRU. Mesma
// foto, dois tratamentos, dependendo do botão. Desde a Onda B (PR #180) a
// câmera NATIVA (quality 90, resolução cheia) virou o caminho principal, então
// "cru" passou a significar 5-12 MB — e o upload grande morria na rede móvel
// dentro da WebView, com o supabase-js devolvendo o TypeError cru do fetch.
//
// Roda o HOOK DE VERDADE (não uma cópia da lógica): reimplementar o miolo no
// teste passaria mesmo com a correção revertida, e teste que não falha sem o
// fix não é teste de regressão.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const uploadMedia = vi.fn();
const createPost = vi.fn();
const compressImage = vi.fn();
const readImageDimensions = vi.fn();

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
// 2026-09-17: usePublishPost ganhou uma chamada a /api/moderate ANTES de
// createPost (ver __tests__/publicar-moderacao.test.tsx). Sem este mock, os
// testes de compressão acima bateriam em `fetch` de verdade. Resposta
// padrão simula Gemini indisponível (res.ok=false) — fail-open, não
// interfere em nenhuma asserção deste arquivo.
const moderateFetch = vi.fn();
vi.mock('@/lib/services/fetchGated', () => ({
  fetchGated: (...a: unknown[]) => moderateFetch(...a),
}));

import { usePublishPost } from '@/lib/hooks/usePublishPost';

/** File com `size` mentido — não dá pra alocar 6 MB de verdade no teste. */
function arquivoDe(nome: string, bytes: number, tipo: string): File {
  const f = new File(['x'], nome, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

const PEQUENA = () => arquivoDe('p.jpg', 500 * 1024, 'image/jpeg');
const GRANDE = () => arquivoDe('g.jpg', 6 * 1024 * 1024, 'image/jpeg');
const VIDEO = () => arquivoDe('v.mp4', 30 * 1024 * 1024, 'video/mp4');

function montar() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => usePublishPost(), { wrapper });
}

/** Os arquivos que CHEGARAM no upload, na ordem. */
function subidos(): File[] {
  return uploadMedia.mock.calls.map((c) => c[1] as File);
}

/**
 * Compara por IDENTIDADE, não por estrutura. `toEqual` em File é armadilha:
 * File não tem propriedade própria enumerável (name/size/type moram no
 * protótipo), então dois arquivos DIFERENTES passam como iguais — este teste
 * chegou a passar com a correção revertida por causa disso. Aqui o que
 * importa é se subiu ESTE objeto ou AQUELE.
 */
function expectMesmosArquivos(recebidos: File[], esperados: File[]) {
  expect(recebidos).toHaveLength(esperados.length);
  esperados.forEach((esperado, i) => expect(recebidos[i]).toBe(esperado));
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadMedia.mockResolvedValue({ url: 'https://x/y.jpg', mediaHash: 'h' });
  createPost.mockResolvedValue({ id: 'p1' });
  readImageDimensions.mockResolvedValue({ width: 1920, height: 1080 });
  moderateFetch.mockResolvedValue({ ok: false } as Response);
});

describe('publicar: a foto grande é comprimida ANTES de subir', () => {
  it('imagem acima do limiar sobe COMPRIMIDA, não a original', async () => {
    const original = GRANDE();
    const comprimida = arquivoDe('g.jpg', 800 * 1024, 'image/jpeg');
    compressImage.mockResolvedValue(comprimida);

    const { result } = montar();
    await result.current.publishAsync({
      files: [original],
      caption: 'oi',
      mediaType: 'image',
    });

    expect(compressImage.mock.calls[0][0]).toBe(original);
    // O ponto do teste: o que chega no upload NÃO é o arquivo cru.
    expectMesmosArquivos(subidos(), [comprimida]);
  });

  it('as dimensões gravadas são as do arquivo QUE SUBIU', async () => {
    // Comprimir muda W/H. Gravar as do original reservaria o espaço errado
    // no feed — exatamente o salto de layout que a Wave 17 existe pra matar.
    const original = GRANDE();
    const comprimida = arquivoDe('g.jpg', 800 * 1024, 'image/jpeg');
    compressImage.mockResolvedValue(comprimida);

    const { result } = montar();
    await result.current.publishAsync({
      files: [original],
      caption: '',
      mediaType: 'image',
    });

    expect(readImageDimensions.mock.calls[0][0]).toBe(comprimida);
  });

  it('imagem pequena passa intocada — comprimir de graça só perderia qualidade', async () => {
    const p = PEQUENA();
    const { result } = montar();
    await result.current.publishAsync({
      files: [p],
      caption: '',
      mediaType: 'image',
    });

    expect(compressImage).not.toHaveBeenCalled();
    expectMesmosArquivos(subidos(), [p]);
  });

  it('vídeo NUNCA passa pelo compressor de imagem', async () => {
    const v = VIDEO();
    const { result } = montar();
    await result.current.publishAsync({
      files: [v],
      caption: '',
      mediaType: 'video',
    });

    expect(compressImage).not.toHaveBeenCalled();
    expectMesmosArquivos(subidos(), [v]);
  });

  it('falha ao comprimir não impede publicar — sobe o original', async () => {
    // HEIC que a WebView não decodifica pelo <img> rejeita aqui, e hoje esse
    // arquivo sobe cru sem problema nenhum. Comprimir é otimização, não porta.
    const original = GRANDE();
    compressImage.mockRejectedValue(new Error('Falha ao decodificar imagem'));

    const { result } = montar();
    const post = await result.current.publishAsync({
      files: [original],
      caption: '',
      mediaType: 'image',
    });

    expect(post).toEqual({ id: 'p1' });
    expectMesmosArquivos(subidos(), [original]);
  });

  it('no carrossel, cada foto é avaliada por si', async () => {
    const grande = GRANDE();
    const pequena = PEQUENA();
    const comprimida = arquivoDe('g.jpg', 700 * 1024, 'image/jpeg');
    compressImage.mockResolvedValue(comprimida);

    const { result } = montar();
    await result.current.publishAsync({
      files: [grande, pequena],
      caption: '',
      mediaType: 'image',
    });

    expect(compressImage).toHaveBeenCalledTimes(1);
    expectMesmosArquivos(subidos(), [comprimida, pequena]);
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    expect(createPost.mock.calls[0][0].mediaUrls).toHaveLength(2);
  });
});
