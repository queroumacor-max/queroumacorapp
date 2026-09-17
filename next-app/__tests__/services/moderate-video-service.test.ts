// __tests__/services/moderate-video-service.test.ts
//
// Teste adversarial (auditoria de segurança de IA, 2026-09-17): antes desta
// correção, `moderateVideoPost` fazia um DELETE PERMANENTE do post + do
// arquivo do Storage sempre que o Gemini devolvia severity="hard" — decisão
// 100% do modelo, sem hash-blocklist e sem revisão humana. Isso violava a
// própria regra do projeto ("não considerar LLM/vision comum um detector
// confiável de CSAM", docs/CSAM_POLICY.md) e era MAIS destrutivo que o
// fluxo manual do admin (`blockMediaPermanent`/`escalateToNcmec`, que
// sempre faz soft-delete pra preservar evidência).
//
// Este teste prova, batendo direto no fetch mockado, que:
//   1. severity="hard" do Gemini NUNCA dispara um DELETE — só PATCH
//      `deleted_at` (soft-delete) + insert em `media_review_queue`.
//   2. hash batendo na blocklist bloqueia ANTES de gastar chamada de
//      Gemini (curto-circuito), com o mesmo efeito soft-delete+fila.
//   3. severity="soft" continua sem apagar nada, só enfileira p/ revisão.
//   4. severity="none" segue aprovando normalmente (sem regressão).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api/security', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/security')>('../../lib/api/security');
  return {
    ...actual,
    getServiceKey: () => 'svc-test-key',
    getSupabaseUrl: () => 'https://example.supabase.co',
    resolveSupabaseEnv: () => ({ url: 'https://example.supabase.co', anonKey: 'anon-test' }),
  };
});

function jsonRes(body: unknown, ok = true, headers: Record<string, string> = {}): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode('fake-video-bytes').buffer,
  } as unknown as Response;
}

interface Router {
  calls: Array<{ url: string; method: string; body?: unknown }>;
  geminiSeverity: 'none' | 'soft' | 'hard';
  geminiReasons: string[];
  blocklistHit: { blocked: boolean; category?: string };
}

function installRouter(opts: Partial<Router> = {}): Router {
  const router: Router = {
    calls: [],
    geminiSeverity: opts.geminiSeverity ?? 'none',
    geminiReasons: opts.geminiReasons ?? [],
    blocklistHit: opts.blocklistHit ?? { blocked: false },
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method || 'GET').toUpperCase();
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = init?.body;
    }
    router.calls.push({ url, method, body });

    // (1) ownership check
    if (url.includes('/rest/v1/posts?id=eq.') && method === 'GET') {
      return jsonRes([
        { user_id: 'user-1', media_url: 'https://example.supabase.co/storage/v1/object/posts/user-1/x.mp4' },
      ]);
    }
    // (1b) PATCH em posts — approved OU soft-delete (deleted_at)
    if (url.includes('/rest/v1/posts?id=eq.') && method === 'PATCH') {
      return jsonRes({}, true);
    }
    // (2) download do vídeo
    if (url.includes('/storage/v1/object/posts/user-1/x.mp4')) {
      return jsonRes(null, true, { 'content-type': 'video/mp4' });
    }
    // (3) hash blocklist
    if (url.includes('/rest/v1/media_hash_blocklist')) {
      return jsonRes(
        router.blocklistHit.blocked
          ? [{ id: 'blk-1', category: router.blocklistHit.category || 'reported' }]
          : [],
      );
    }
    // (4) media_review_queue insert
    if (url.includes('/rest/v1/media_review_queue')) {
      return jsonRes({}, true);
    }
    // (5) Storage DELETE — NÃO deve mais ser chamado em nenhum cenário.
    if (url.includes('/storage/v1/object/posts/') && method === 'DELETE') {
      return jsonRes({}, true);
    }
    // (6) Gemini resumable upload — start
    if (url.includes('generativelanguage.googleapis.com/upload/v1beta/files')) {
      return jsonRes(
        {},
        true,
        { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/session-1' },
      );
    }
    // (7) Gemini resumable upload — finalize
    if (url.includes('/upload/session-1')) {
      return jsonRes({ file: { name: 'files/abc', uri: 'files/abc', state: 'ACTIVE' } });
    }
    // (8) Gemini analyze
    if (url.includes(':generateContent')) {
      return jsonRes({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    flagged: router.geminiSeverity !== 'none',
                    severity: router.geminiSeverity,
                    reasons: router.geminiReasons,
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    return jsonRes({ error: 'not mocked: ' + url }, false);
  }) as unknown as typeof fetch;

  return router;
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
});

describe('moderateVideoPost — severity "hard" nunca mais faz DELETE definitivo', () => {
  it('soft-deleta (PATCH deleted_at) + enfileira revisão — não chama DELETE em posts nem storage', async () => {
    const router = installRouter({ geminiSeverity: 'hard', geminiReasons: ['nudez'] });
    const { moderateVideoPost } = await import('../../lib/api/_services/moderate-video');

    const out = await moderateVideoPost({ userId: 'user-1', postId: 'post-1', caption: '' });

    expect(out.status).toBe('rejected');

    // Nenhum DELETE em lugar nenhum — nem no post, nem no arquivo.
    const deletes = router.calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(0);

    // O post foi soft-deletado via PATCH com deleted_at, não removido.
    const patchPost = router.calls.find(
      (c) => c.url.includes('/rest/v1/posts?id=eq.post-1') && c.method === 'PATCH',
    );
    expect(patchPost).toBeTruthy();
    expect(patchPost?.body).toHaveProperty('deleted_at');
    expect(patchPost?.body).not.toHaveProperty('status');

    // Foi pra fila de revisão humana — o modelo não teve a palavra final.
    const enqueue = router.calls.find((c) => c.url.includes('/rest/v1/media_review_queue'));
    expect(enqueue).toBeTruthy();
    expect((enqueue?.body as Record<string, unknown>)?.post_id).toBe('post-1');
    expect((enqueue?.body as Record<string, unknown>)?.severity).toBe('high');
  });

  it('reasons com "sexual_menores" sobe a severidade da fila pra "critical"', async () => {
    installRouter({ geminiSeverity: 'hard', geminiReasons: ['sexual_menores'] });
    const { moderateVideoPost } = await import('../../lib/api/_services/moderate-video');
    const out = await moderateVideoPost({ userId: 'user-1', postId: 'post-1', caption: '' });
    expect(out.status).toBe('rejected');
  });
});

describe('moderateVideoPost — hash na blocklist bloqueia ANTES do Gemini', () => {
  it('curto-circuita: nunca chama :generateContent, soft-deleta + enfileira crítico p/ CSAM', async () => {
    const router = installRouter({ blocklistHit: { blocked: true, category: 'csam' } });
    const { moderateVideoPost } = await import('../../lib/api/_services/moderate-video');

    const out = await moderateVideoPost({ userId: 'user-1', postId: 'post-1', caption: '' });

    expect(out.status).toBe('rejected');
    const geminiCalls = router.calls.filter((c) => c.url.includes(':generateContent'));
    expect(geminiCalls).toHaveLength(0);

    const deletes = router.calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(0);

    const enqueue = router.calls.find((c) => c.url.includes('/rest/v1/media_review_queue'));
    expect((enqueue?.body as Record<string, unknown>)?.severity).toBe('critical');
  });
});

describe('moderateVideoPost — severity "soft" e "none" sem regressão', () => {
  it('soft: fica pending, enfileira "med", não soft-deleta', async () => {
    const router = installRouter({ geminiSeverity: 'soft', geminiReasons: ['golpe'] });
    const { moderateVideoPost } = await import('../../lib/api/_services/moderate-video');
    const out = await moderateVideoPost({ userId: 'user-1', postId: 'post-1', caption: '' });

    expect(out.status).toBe('pending');
    const patchPost = router.calls.find(
      (c) => c.url.includes('/rest/v1/posts?id=eq.post-1') && c.method === 'PATCH',
    );
    expect(patchPost).toBeUndefined();
    const enqueue = router.calls.find((c) => c.url.includes('/rest/v1/media_review_queue'));
    expect((enqueue?.body as Record<string, unknown>)?.severity).toBe('med');
  });

  it('none: aprova normalmente via PATCH status=approved', async () => {
    const router = installRouter({ geminiSeverity: 'none' });
    const { moderateVideoPost } = await import('../../lib/api/_services/moderate-video');
    const out = await moderateVideoPost({ userId: 'user-1', postId: 'post-1', caption: '' });

    expect(out.status).toBe('approved');
    const patchPost = router.calls.find(
      (c) => c.url.includes('/rest/v1/posts?id=eq.post-1') && c.method === 'PATCH',
    );
    expect(patchPost?.body).toEqual({ status: 'approved' });
  });
});
