// __tests__/api/generate-logo.test.ts — testes do route `/api/generate-logo`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installAuthMocks, mkJsonReq, type InstalledMocks } from './_helpers';

let mocks: InstalledMocks | null = null;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
});

afterEach(() => {
  if (mocks) mocks.restore();
  mocks = null;
});

describe('POST /api/generate-logo', () => {
  it('rejeita corpo grande (413) antes de qualquer gate (auditoria 2026-09-13)', async () => {
    const req = new Request('https://app.test/api/generate-logo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024) },
      body: '{}',
    });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(req as never);
    expect(res.status).toBe(413);
  });

  it('returns 503 when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali' }) as never
    );
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not PRO', async () => {
    mocks = installAuthMocks({ pro: false });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali' }) as never
    );
    expect(res.status).toBe(403);
  });

  // O gpt-image-1 devolve base64; o route materializa isso no Storage e
  // registra em `brand_logos` (Wave 37) — é o que o /portal lê depois.
  it('happy path: persiste as 3 imagens no storage e devolve as URLs públicas', async () => {
    mocks = installAuthMocks({
      fetchRest: async (url) => {
        if (url.includes('api.openai.com')) {
          return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), {
            status: 200,
          });
        }
        // Upload no storage + insert no PostgREST.
        return new Response('{}', { status: 200 });
      },
    });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', {
        name: 'Cali Colors',
        style: 'modern',
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.urls).toHaveLength(3);
    expect(body.urls[0]).toContain('/storage/v1/object/public/posts/');
    expect(body.urls[0]).toContain('user-test-id/logos/');

    const uploads = mocks.calls.filter((c) =>
      c.url.includes('/storage/v1/object/posts/')
    );
    expect(uploads).toHaveLength(3);

    const inserts = mocks.calls.filter((c) =>
      c.url.includes('/rest/v1/brand_logos')
    );
    expect(inserts).toHaveLength(1);
    const rows = JSON.parse(String(inserts[0].init?.body));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      user_id: 'user-test-id',
      source: 'ai',
      prompt_name: 'Cali Colors',
      prompt_style: 'modern',
    });
  });

  // Storage fora do ar não pode custar o logo que o pintor acabou de gerar:
  // a resposta cai de volta na data URL da IA.
  it('storage indisponível → devolve as data URLs da IA (não quebra)', async () => {
    mocks = installAuthMocks({
      fetchRest: async (url) => {
        if (url.includes('api.openai.com')) {
          return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), {
            status: 200,
          });
        }
        return new Response('storage down', { status: 500 });
      },
    });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali Colors' }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.urls).toHaveLength(3);
    expect(body.urls[0]).toContain('data:image/png;base64,');
    // Nada de linha órfã em brand_logos apontando pra arquivo que não subiu.
    expect(
      mocks.calls.filter((c) => c.url.includes('/rest/v1/brand_logos'))
    ).toHaveLength(0);
  });

  // "Toda imagem gerada tem que ficar salva": um 500 passageiro do storage
  // não pode custar a arte — a 2ª tentativa salva.
  it('storage falha na 1ª tentativa → retry arquiva mesmo assim', async () => {
    const seen = new Set<string>();
    mocks = installAuthMocks({
      fetchRest: async (url) => {
        if (url.includes('api.openai.com')) {
          return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), {
            status: 200,
          });
        }
        if (url.includes('/storage/v1/object/posts/')) {
          // Falha só na primeira vez que vê cada path.
          if (!seen.has(url)) {
            seen.add(url);
            return new Response('flaky', { status: 500 });
          }
          return new Response('{}', { status: 200 });
        }
        return new Response('{}', { status: 200 });
      },
    });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali Colors' }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.urls.every((u: string) => u.includes('/logos/'))).toBe(true);

    const inserts = mocks.calls.filter((c) =>
      c.url.includes('/rest/v1/brand_logos')
    );
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(String(inserts[0].init?.body))).toHaveLength(3);
  });

  it('returns 400 when name missing', async () => {
    mocks = installAuthMocks();
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(mkJsonReq('/api/generate-logo', {}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 500 when DALL-E returns no image', async () => {
    mocks = installAuthMocks({
      fetchRest: async () =>
        new Response(JSON.stringify({ data: [{}] }), { status: 200 }),
    });
    const { POST } = await import('@/app/api/generate-logo/route');
    const res = await POST(
      mkJsonReq('/api/generate-logo', { name: 'Cali' }) as never
    );
    // ServiceError 502 esperado quando Promise.all não devolve imagem.
    expect([500, 502]).toContain(res.status);
  });
});
