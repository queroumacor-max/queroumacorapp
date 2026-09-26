// approvePost — o servidor decide se o post vai ao ar (2026-09-26).
// Tudo sai do BANCO (fetch falso do PostgREST), nada do cliente.
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

import { approvePost } from '../../lib/api/_services/post-approval';

const FOTO1 = 'https://proj.supabase.co/storage/v1/object/public/posts/u1/a.jpg';
const FOTO2 = 'https://proj.supabase.co/storage/v1/object/public/posts/u1/b.jpg';
const VID = 'https://proj.supabase.co/storage/v1/object/public/posts/u1/v.mp4';

let linha: Record<string, unknown>;
let patches: Array<{ url: string; body: Record<string, unknown> }>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  patches = [];
  linha = {
    id: 'p1',
    user_id: 'u1',
    status: 'pending',
    media_url: FOTO1,
    media_urls: null,
    media_type: 'image',
    caption: 'legenda',
    deleted_at: null,
  };
  checkHashBlocklist.mockResolvedValue({ blocked: false });
  moderateContent.mockResolvedValue({ flagged: false, severity: 'none', reasons: [] });
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rest/v1/posts') && (init?.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => [linha] } as Response;
    }
    if (u.includes('/rest/v1/posts') && init?.method === 'PATCH') {
      patches.push({ url: u, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 204, json: async () => null } as Response;
    }
    // download da mídia
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) } as Response;
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('approvePost', () => {
  it('post de outra pessoa → 403, nada é gravado', async () => {
    await expect(approvePost({ userId: 'intruso', postId: 'p1' })).rejects.toMatchObject({
      status: 403,
    });
    expect(patches).toEqual([]);
  });

  it('já aprovado → idempotente, não modera de novo', async () => {
    linha.status = 'approved';
    await expect(approvePost({ userId: 'u1', postId: 'p1' })).resolves.toEqual({
      status: 'approved',
    });
    expect(moderateContent).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it('foto aprovada → PATCH condicional (status=pending) com o hash calculado NO SERVIDOR', async () => {
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: false });
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toContain('status=eq.pending');
    expect(patches[0].body).toEqual({ status: 'approved', media_hash: 'hash-real' });
    expect(moderateContent).toHaveBeenCalledWith({ text: 'legenda', imageUrl: FOTO1 });
  });

  it('hash na blocklist → rejeita, soft-delete e fila crítica, sem gastar Gemini', async () => {
    checkHashBlocklist.mockResolvedValue({ blocked: true, category: 'csam' });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out.status).toBe('rejected');
    expect(moderateContent).not.toHaveBeenCalled();
    expect(patches[0].body).toMatchObject({ status: 'rejected', deleted_at: expect.any(String) });
    expect(enqueueMediaReview).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', mediaHash: 'hash-real' }),
    );
  });

  it('carrossel: reprovação na 2ª foto derruba o post inteiro; legenda só vai na 1ª', async () => {
    linha.media_urls = [FOTO1, FOTO2];
    moderateContent.mockImplementation(async (a: { imageUrl: string }) =>
      a.imageUrl === FOTO2
        ? { flagged: true, severity: 'hard', reasons: ['nudez'] }
        : { flagged: false, severity: 'none', reasons: [] },
    );
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'rejected', reasons: ['nudez'] });
    expect(moderateContent).toHaveBeenCalledWith({ text: undefined, imageUrl: FOTO2 });
    expect(patches[0].body.status).toBe('rejected');
  });

  it('soft → publica, mas vai pra fila de revisão humana', async () => {
    moderateContent.mockResolvedValue({ flagged: true, severity: 'soft', reasons: ['spam'] });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: true });
    expect(enqueueMediaReview).toHaveBeenCalledWith(expect.objectContaining({ severity: 'med' }));
  });

  it('Gemini fora do ar → publica (fail-open) e vai pra fila — alguém fica sabendo', async () => {
    moderateContent.mockRejectedValue(new Error('gemini 503'));
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: true });
    expect(enqueueMediaReview).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'moderacao_indisponivel' }),
    );
  });

  it('vídeo: pipeline de vídeo; rejected passa adiante sem aprovar', async () => {
    linha.media_url = VID;
    linha.media_type = 'video';
    moderateVideoPost.mockResolvedValue({ status: 'rejected', reasons: ['violencia'] });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'rejected', reasons: ['violencia'], video: true });
    expect(patches).toEqual([]);
    expect(moderateContent).not.toHaveBeenCalled();
  });

  it('vídeo em revisão (pending) → publica e marca revisão', async () => {
    linha.media_url = VID;
    linha.media_type = 'video';
    moderateVideoPost.mockResolvedValue({ status: 'pending', reason: 'vídeo grande' });
    const out = await approvePost({ userId: 'u1', postId: 'p1' });
    expect(out).toEqual({ status: 'approved', revisao: true, video: true });
    expect(patches[0].body).toEqual({ status: 'approved' });
  });
});
