// Testes de lib/api/_services/moderate-video.ts (`moderateVideoPost`).
//
// 2026-09-17 (achado do Codex na revisão da PR de documentação #327):
// `moderateVideoPost` devolvia `status:'pending'` em 4 pontos diferentes
// (media_url suspeita, vídeo grande, falha de download, falha de análise,
// mais o caso soft/flagged) SEM NUNCA gravar nada em `media_review_queue`
// — um dos textos dizia literalmente "enviado para revisão humana" e não
// enviava nada. O post nascia `status='approved'` (default do `createPost`)
// e ficava público pra sempre, sem NINGUÉM olhar. Este arquivo prova que
// TODO caminho 'pending' agora chama `enqueueMediaReview`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const enqueueMediaReviewMock = vi.fn(async (_args: unknown) => {});
vi.mock('@/lib/api/mediaHash', () => ({
  enqueueMediaReview: (args: unknown) => enqueueMediaReviewMock(args),
}));

import { moderateVideoPost } from '../../lib/api/_services/moderate-video';

const MEDIA_URL = 'https://test.supabase.co/storage/v1/object/public/posts/u1/v.mp4';
const USER_ID = 'u1';
const POST_ID = 'p1';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Response de upload resumable do Gemini já ACTIVE (pula o polling). */
function geminiUploadStartRes(): Response {
  return new Response('{}', {
    status: 200,
    headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload-session-1' },
  });
}
function geminiUploadFinalizeRes(): Response {
  return jsonRes({ file: { name: 'files/abc', uri: 'https://files/abc', state: 'ACTIVE' } });
}
function geminiAnalyzeRes(verdict: { flagged: boolean; severity: string; reasons: string[] }): Response {
  return jsonRes({
    candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] } }],
  });
}

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function installFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  }) as unknown as typeof fetch;
}

/** Roteador padrão: só a consulta de dono/media_url; caller injeta o resto. */
function baseRouter(extra: (url: string, init?: RequestInit) => Response | null | Promise<Response | null>) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/rest/v1/posts?id=eq.') && (!init?.method || init.method === 'GET')) {
      return jsonRes([{ user_id: USER_ID, media_url: MEDIA_URL }]);
    }
    if (url.includes('/rest/v1/posts?id=eq.') && (init?.method === 'PATCH' || init?.method === 'DELETE')) {
      return jsonRes({});
    }
    if (url.startsWith('https://test.supabase.co/storage/v1/object/posts/')) {
      // Cleanup do storage no reject.
      return jsonRes({});
    }
    const r = await extra(url, init);
    if (r) return r;
    return new Response('not mocked: ' + url, { status: 500 });
  };
}

beforeEach(() => {
  enqueueMediaReviewMock.mockClear();
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';
  process.env.GEMINI_API_KEY = 'gemini-test';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('moderateVideoPost — todo caminho pending enfileira em media_review_queue', () => {
  it('media_url fora do storage do projeto → pending E enfileira', async () => {
    installFetch(
      baseRouter(() => null),
    );
    // Sobrescreve a resposta de lookup pra devolver uma URL de fora.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/rest/v1/posts?id=eq.') && (!init?.method || init.method === 'GET')) {
        return jsonRes([{ user_id: USER_ID, media_url: 'https://evil.example.com/v.mp4' }]);
      }
      return new Response('not mocked', { status: 500 });
    }) as unknown as typeof fetch;

    const out = await moderateVideoPost({ userId: USER_ID, postId: POST_ID, caption: '' });
    expect(out.status).toBe('pending');
    expect(enqueueMediaReviewMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMediaReviewMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.postId).toBe(POST_ID);
    expect(arg.userId).toBe(USER_ID);
  });

  it('vídeo maior que o teto → pending E enfileira', async () => {
    installFetch(
      baseRouter((url) => {
        if (url === MEDIA_URL) {
          const big = new Uint8Array(26 * 1024 * 1024); // > MAX_BYTES (25MB)
          return new Response(big, { headers: { 'content-type': 'video/mp4' } });
        }
        return null;
      }),
    );

    const out = await moderateVideoPost({ userId: USER_ID, postId: POST_ID, caption: '' });
    expect(out.status).toBe('pending');
    expect(enqueueMediaReviewMock).toHaveBeenCalledTimes(1);
  });

  it('falha ao baixar o vídeo → pending E enfileira', async () => {
    installFetch(
      baseRouter((url) => {
        if (url === MEDIA_URL) return new Response('nope', { status: 500 });
        return null;
      }),
    );

    const out = await moderateVideoPost({ userId: USER_ID, postId: POST_ID, caption: '' });
    expect(out.status).toBe('pending');
    expect(enqueueMediaReviewMock).toHaveBeenCalledTimes(1);
  });

  it('falha na análise Gemini (upload quebra) → pending E enfileira', async () => {
    installFetch(
      baseRouter((url) => {
        if (url === MEDIA_URL) {
          return new Response(new Uint8Array(100), { headers: { 'content-type': 'video/mp4' } });
        }
        if (url.includes('/upload/v1beta/files')) {
          return new Response('boom', { status: 500 });
        }
        return null;
      }),
    );

    const out = await moderateVideoPost({ userId: USER_ID, postId: POST_ID, caption: '' });
    expect(out.status).toBe('pending');
    expect(enqueueMediaReviewMock).toHaveBeenCalledTimes(1);
  });

  it('conteúdo soft/flagged → pending E enfileira, com os motivos do Gemini', async () => {
    installFetch(
      baseRouter((url) => {
        if (url === MEDIA_URL) {
          return new Response(new Uint8Array(100), { headers: { 'content-type': 'video/mp4' } });
        }
        if (url.includes('/upload/v1beta/files')) return geminiUploadStartRes();
        if (url.includes('upload-session-1')) return geminiUploadFinalizeRes();
        if (url.includes(':generateContent')) {
          return geminiAnalyzeRes({ flagged: true, severity: 'soft', reasons: ['golpe'] });
        }
        return null;
      }),
    );

    const out = await moderateVideoPost({ userId: USER_ID, postId: POST_ID, caption: 'oi' });
    expect(out.status).toBe('pending');
    expect(enqueueMediaReviewMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMediaReviewMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.reason).toContain('golpe');
  });
});

describe('moderateVideoPost — os outros desfechos não mudaram', () => {
  // 2026-09-17 (auditoria de segurança de IA): esta expectativa MUDOU de
  // propósito. Antes, severity="hard" fazia DELETE PERMANENTE do post sem
  // enfileirar nada — a IA tinha a palavra final e a ação era irreversível.
  // Agora "hard" nunca deleta: soft-deleta (some do ar igual antes) e
  // ENFILEIRA pra revisão humana, como qualquer outro caso ambíguo. Ver
  // `lib/api/_services/moderate-video.ts` (softRejectAndEnqueue).
  it('severity hard → rejected, soft-deleta o post (nunca DELETE) e enfileira pra revisão humana', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    installFetch(
      baseRouter((url) => {
        if (url === MEDIA_URL) {
          return new Response(new Uint8Array(100), { headers: { 'content-type': 'video/mp4' } });
        }
        if (url.includes('/upload/v1beta/files')) return geminiUploadStartRes();
        if (url.includes('upload-session-1')) return geminiUploadFinalizeRes();
        if (url.includes(':generateContent')) {
          return geminiAnalyzeRes({ flagged: true, severity: 'hard', reasons: ['nudez'] });
        }
        return null;
      }),
    );
    const originalRouterFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, method: (init?.method || 'GET').toUpperCase() });
      return (originalRouterFetch as typeof fetch)(input, init);
    }) as unknown as typeof fetch;

    const out = await moderateVideoPost({ userId: USER_ID, postId: POST_ID, caption: '' });

    expect(out.status).toBe('rejected');
    expect(enqueueMediaReviewMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMediaReviewMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.postId).toBe(POST_ID);
    expect(arg.severity).toBe('high');

    // Nunca um DELETE — nem no post, nem no arquivo do storage.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const patchPost = calls.find(
      (c) => c.url.includes('/rest/v1/posts?id=eq.') && c.method === 'PATCH',
    );
    expect(patchPost).toBeTruthy();
  });

  it('conteúdo limpo → approved, NÃO enfileira', async () => {
    installFetch(
      baseRouter((url) => {
        if (url === MEDIA_URL) {
          return new Response(new Uint8Array(100), { headers: { 'content-type': 'video/mp4' } });
        }
        if (url.includes('/upload/v1beta/files')) return geminiUploadStartRes();
        if (url.includes('upload-session-1')) return geminiUploadFinalizeRes();
        if (url.includes(':generateContent')) {
          return geminiAnalyzeRes({ flagged: false, severity: 'none', reasons: [] });
        }
        return null;
      }),
    );

    const out = await moderateVideoPost({ userId: USER_ID, postId: POST_ID, caption: '' });
    expect(out.status).toBe('approved');
    expect(enqueueMediaReviewMock).not.toHaveBeenCalled();
  });
});
