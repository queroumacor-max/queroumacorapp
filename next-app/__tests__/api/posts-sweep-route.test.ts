// /api/posts/sweep-pending — só o cron do banco (segredo interno) dispara.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let env: Record<string, string | undefined> = {};
vi.mock('@/lib/api/env', () => ({ getRuntimeEnv: (k: string) => env[k] }));
const sweep = vi.fn();
vi.mock('@/lib/api/_services/post-approval', () => ({ sweepPendingPosts: () => sweep() }));
vi.mock('@/lib/api/security', async () => {
  const real = await vi.importActual<typeof import('@/lib/api/security')>('@/lib/api/security');
  return {
    ...real,
    checkRateLimit: async () => ({ allowed: true }),
  };
});

import { POST } from '@/app/api/posts/sweep-pending/route';

function req(secret?: string) {
  return new Request('https://x/api/posts/sweep-pending', {
    method: 'POST',
    headers: secret ? { 'x-internal-secret': secret } : {},
  }) as never;
}

beforeEach(() => {
  env = { PUSH_INTERNAL_SECRET: 'segredo-certo' };
  sweep.mockReset().mockResolvedValue({ encontrados: 2, aprovados: 2, reprovados: 0, falhas: 0 });
});

describe('POST /api/posts/sweep-pending', () => {
  it('sem segredo configurado → 503 (fail-closed), não varre', async () => {
    env = {};
    expect((await POST(req('qualquer'))).status).toBe(503);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('segredo ausente ou errado → 401, não varre', async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req('segredo-errado'))).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('segredo certo → varre e devolve o resumo', async () => {
    const r = await POST(req('segredo-certo'));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, aprovados: 2 });
  });
});
