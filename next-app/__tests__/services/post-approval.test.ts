// approvePost — o servidor decide se o post vai ao ar (2026-09-26).
// Tudo sai do BANCO (fetch falso do PostgREST/Storage), nada do cliente.
// Cobre também os 4 achados P1 do Codex no PR #435.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/api/security', async () => {
  const real = await vi.importActual<typeof import('../../lib/api/security')>(
    '../../lib/api/security',
  );
  return {
    ServiceError: real.ServiceError,
    getServiceKey: () => 'svc',
    getSupabaseUrl: () => 'https://proj.supabase.co',
  };
});
vi.mock('../../lib/api/env', () => ({ getRuntimeEnv: () => 'gemini-key' }));
const checkHashBlocklist = vi.fn();
const enqueueMediaReview = vi.fn();
vi.mock('../../lib/api/mediaHash', () => ({
  hashMedia: async () => 'hash-real',
  checkHashBlocklist: (h: string) => checkHashBlocklist(h),
  enqueueMediaReview: (a: unknown) => enqueueMediaReview(a),
}));
const moderateContent = vi.fn();
vi.mock('../../lib/api/_services/moderate', () => ({
  moderateContent: (a: unknown) => moderateContent(a),
}));
const moderateVideoPost = vi.fn();
vi.mock('../../lib/api/_services/moderate-video', () => ({
  moderateVideoPost: (a: unknown) => moderateVideoPost(a),
}));
vi.mock('../../lib/api/securityEvents', () => ({ logSecurityEvent: vi.fn() }));

import {
  approvePost,
  chaveNoBucketPosts,
  midiasExibidas,
} from '../../lib/api/_services/post-approval';

const PUB = 'https://proj.supabase.co/storage/v1/object/public/posts/';
const FOTO1 = `${PUB}u1/a.jpg`;
const FOTO2 = `${PUB}u1/b.jpg`;
const VID = `${PUB}u1/v.mp4`;
const COPIA = (i: number, nome: string) => `${PUB}approved/u1/p1-${i}-${nome}`;

let linha: Record<string, unknown>;
let patches: Array<{ url: string; body: Record<string, unknown> }>;
let copias: Array<{ sourceKey: string; destinationKey: string }>;
let rpc: Array<Record<string, unknown>>;
let rpcResposta: { status: number; body: unknown };
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  patches = [];
  copias = [];
  rpc = [];
  rpcResposta = { status: 200, body: true };
  linha = {
    id: 'p1',
    user_id: 'u1',
    status: 'pending',
    media_url: FOTO1,
    media_urls: null,
    media_type: 'image',
    caption: 'legenda',
    link_url: null,
    deleted_at: null,
  };
  checkHashBlocklist.mockResolvedValue({ blocked: false });
  moderateContent.mockResolvedValue({ flagged: false, severity: 'none', reasons: [] });
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const metodo = init?.method || 'GET';
    if (u.includes('/rest/v1/rpc/approve_post_moderated')) {
      rpc.push(JSON.parse(String(init?.body)));
      return {
        ok: rpcResposta.status < 300,
        status: rpcResposta.status,
        json: async () => rpcResposta.body,
        text: async () => JSON.stringify(rpcResposta.body),
      } as Response;
    }
    if (u.includes('/storage/v1/object/copy')) {
      copias.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, text: async () => '' } as Response;
    }
    if (u.includes('/rest/v1/posts') && metodo === 'GET') {
      return { ok: true, status: 200, json: async () => [linha] } as Response;
    }
    if (u.includes('/rest/v1/posts') && metodo === 'PATCH') {
      patches.push({ url: u, body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 204, json: async () => null } as Response;
    }
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) } as Response;
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('helpers', () => {
  it('chaveNoBucketPosts só aceita o host EXATO do projeto e o bucket posts', () => {
    expect(chaveNoBucketPosts(FOTO1, 'https://proj.supabase.co')).toBe('u1/a.jpg');
    expect(
      chaveNoBucketPosts('https://outro.supabase.co/storage/v1/object/public/posts/u1/a.jpg', 'https://proj.supabase.co'),
    ).toBeNull();
    expect(
      chaveNoBucketPosts('https://proj.supabase.co/storage/v1/object/public/avatars/u1/a.jpg', 'https://proj.supabase.co'),
    ).toBeNull();
    expect(chaveNoBucketPosts(`${PUB}u1/..%2Fu2/x.jpg`, 'https://proj.supabase.co')).toBeNull();
  });

  it('midiasExibidas junta media_url + media_urls sem repetir e recusa mais de 5', () => {
    expect(midiasExibidas({ media_url: FOTO1, media_urls: [FOTO1, FOTO2] })).toEqual([FOTO1, FOTO2]);
    expect(midiasExibidas({ media_url: 'x', media_urls: [FOTO1, FOTO2] })).toEqual(['x', FOTO1, FOTO2]);
    const seis = Array.from({ length: 6 }, (_, i) => `${PUB}u1/${i}.jpg`);
    expect(midiasExibidas({ media_url: seis[0], media_urls: seis })).toBeNull();
  });
});

describe('approvePost', () => {
  it('post de outra pessoa → 403, nada é gravado', async () => {
    await expect(approvePost({ userId: 'intruso', postId: 'p1' })).rejects.toMatchObject({
      status: 403,
    });
    expect(patches).toEqual([]);
    expect(rpc).toEqual([]);
  });

  it('já aprovado → idempotente, não modera de novo', async () => {
    linha.status = 'approved';
    await expect(approvePost({ userId: 'u1', postId: 'p1' })).resolves.toEqual({ status: 'approved' });
    expect(moderateContent).not.toHaveBeenCalled();
  });

  it('foto aprovada: copia pra approved/, modera a CÓPIA e aprova por compare-and-set', async () => {
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: false });
    expect(copias).toEqual([
      { bucketId: 'posts', sourceKey: 'u1/a.jpg', destinationKey: 'approved/u1/p1-0-a.jpg' },
    ].map(({ sourceKey, destinationKey }) => expect.objectContaining({ sourceKey, destinationKey })));
    expect(moderateContent).toHaveBeenCalledWith({ text: 'legenda', imageUrl: COPIA(0, 'a.jpg') });
    expect(rpc[0]).toMatchObject({
      p_post_id: 'p1',
      p_old_media_url: FOTO1,
      p_old_caption: 'legenda',
      p_new_media_url: COPIA(0, 'a.jpg'),
      p_media_hash: 'hash-real',
    });
  });

  it('conteúdo mudou durante a análise (RPC devolve false) → 409, não aprova', async () => {
    rpcResposta = { status: 200, body: false };
    await expect(approvePost({ userId: 'u1', postId: 'p1' })).rejects.toMatchObject({ status: 409 });
  });

  it('mídia de OUTRO projeto Supabase → rejeitada sem gastar Gemini', async () => {
    linha.media_url = 'https://atacante.supabase.co/storage/v1/object/public/posts/u1/a.jpg';
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'rejected', reasons: ['midia_invalida'] });
    expect(moderateContent).not.toHaveBeenCalled();
    expect(patches[0].body).toMatchObject({ status: 'rejected' });
  });

  it('mídia na pasta de OUTRO usuário → rejeitada', async () => {
    linha.media_url = `${PUB}u2/a.jpg`;
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out.status).toBe('rejected');
  });

  it('mais de 5 mídias (API direta) → rejeitado', async () => {
    linha.media_urls = Array.from({ length: 6 }, (_, i) => `${PUB}u1/${i}.jpg`);
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'rejected', reasons: ['midias_demais'] });
  });

  it('media_url fora do array também é moderado (tudo que alguma tela exibe)', async () => {
    linha.media_url = `${PUB}u1/capa.jpg`;
    linha.media_urls = [FOTO1, FOTO2];
    await approvePost({ userId: 'u1', postId: 'p1' });
    expect(moderateContent).toHaveBeenCalledTimes(3);
  });

  it('link_url entra no texto moderado', async () => {
    linha.link_url = 'https://golpe.example';
    await approvePost({ userId: 'u1', postId: 'p1' });
    expect(moderateContent).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'legenda\nhttps://golpe.example' }),
    );
  });

  it('hash na blocklist → rejeita, soft-delete e fila crítica, sem gastar Gemini', async () => {
    checkHashBlocklist.mockResolvedValue({ blocked: true, category: 'csam' });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out.status).toBe('rejected');
    expect(moderateContent).not.toHaveBeenCalled();
    expect(patches[0].body).toMatchObject({ status: 'rejected', deleted_at: expect.any(String) });
    expect(enqueueMediaReview).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
    expect(rpc).toEqual([]);
  });

  it('carrossel: reprovação na 2ª foto derruba o post inteiro; legenda só vai na 1ª', async () => {
    linha.media_urls = [FOTO1, FOTO2];
    moderateContent.mockImplementation(async (a: { imageUrl: string }) =>
      a.imageUrl === COPIA(1, 'b.jpg')
        ? { flagged: true, severity: 'hard', reasons: ['nudez'] }
        : { flagged: false, severity: 'none', reasons: [] },
    );
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'rejected', reasons: ['nudez'] });
    expect(moderateContent).toHaveBeenCalledWith({ text: undefined, imageUrl: COPIA(1, 'b.jpg') });
  });

  it('soft → publica, mas vai pra fila de revisão humana', async () => {
    moderateContent.mockResolvedValue({ flagged: true, severity: 'soft', reasons: ['spam'] });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: true });
    expect(enqueueMediaReview).toHaveBeenCalledWith(expect.objectContaining({ severity: 'med' }));
  });

  it('Gemini fora do ar → publica (fail-open) e vai pra fila', async () => {
    moderateContent.mockRejectedValue(new Error('gemini 503'));
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: true });
    expect(enqueueMediaReview).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'moderacao_indisponivel' }),
    );
  });

  it('reaprovação (legenda editada): mídia já em approved/ deste post não é copiada de novo', async () => {
    linha.media_url = COPIA(0, 'a.jpg');
    await approvePost({ userId: 'u1', postId: 'p1' });
    expect(copias).toEqual([]);
    expect(rpc[0]).toMatchObject({ p_new_media_url: COPIA(0, 'a.jpg') });
  });

  it('RPC ausente (SQL pendente) → PATCH condicional + releitura, publicar não para', async () => {
    rpcResposta = { status: 404, body: { code: 'PGRST202' } };
    // depois do PATCH a releitura mostra o post aprovado com a cópia
    const original = linha;
    const fetchAntes = globalThis.fetch;
    let leituras = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/rest/v1/posts') && (init?.method || 'GET') === 'GET') {
        leituras++;
        const l = leituras === 1 ? original : { ...original, status: 'approved', media_url: COPIA(0, 'a.jpg') };
        return { ok: true, status: 200, json: async () => [l] } as Response;
      }
      return fetchAntes(url, init);
    }) as typeof fetch;
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out.status).toBe('approved');
    expect(patches[0].url).toContain('status=eq.pending');
    expect(patches[0].url).toContain('media_url=eq.');
  });

  it('vídeo: modera a CÓPIA sem deixar a pipeline aprovar sozinha; rejected passa adiante', async () => {
    linha.media_url = VID;
    linha.media_type = 'video';
    moderateVideoPost.mockResolvedValue({ status: 'rejected', reasons: ['violencia'] });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'rejected', reasons: ['violencia'], video: true });
    expect(moderateVideoPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrlOverride: COPIA(0, 'v.mp4'), aprovar: false }),
    );
    expect(rpc).toEqual([]);
  });

  it('vídeo em revisão (pending) → publica pelo compare-and-set e marca revisão', async () => {
    linha.media_url = VID;
    linha.media_type = 'video';
    moderateVideoPost.mockResolvedValue({ status: 'pending', reason: 'vídeo grande' });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: true, video: true });
    expect(rpc[0]).toMatchObject({ p_new_media_url: COPIA(0, 'v.mp4') });
  });
});

describe('achados do Codex no #437', () => {
  it('legenda editada em post ainda "approved" (SQL (b) pendente) é revalidada', async () => {
    linha.status = 'approved';
    linha.media_url = COPIA(0, 'a.jpg');
    linha.caption = 'pague antes pra liberar';
    moderateContent.mockResolvedValue({ flagged: true, severity: 'hard', reasons: ['golpe'] });
    const out = await approvePost({ userId: 'u1', postId: 'p1', revalidarTexto: true });
    expect(out).toEqual({ status: 'rejected', reasons: ['golpe'] });
    expect(moderateContent).toHaveBeenCalledWith({ text: 'pague antes pra liberar', imageUrl: undefined });
    expect(patches[0].body).toMatchObject({ status: 'rejected' });
  });

  it('sem revalidarTexto, post aprovado segue idempotente', async () => {
    linha.status = 'approved';
    await approvePost({ userId: 'u1', postId: 'p1' });
    expect(moderateContent).not.toHaveBeenCalled();
  });

  it('fallback sem RPC filtra também media_urls (edição concorrente do carrossel não se perde)', async () => {
    rpcResposta = { status: 404, body: { code: 'PGRST202' } };
    linha.media_urls = [FOTO1, FOTO2];
    const out = await approvePost({ userId: 'u1', postId: 'p1' }).catch((e) => e);
    // a releitura do fake devolve a linha original (pending) → não conta como aprovado
    expect(out).toMatchObject({ status: 409 });
    expect(decodeURIComponent(patches[0].url)).toContain(`media_urls=eq.{"${FOTO1}","${FOTO2}"}`);
  });
});
