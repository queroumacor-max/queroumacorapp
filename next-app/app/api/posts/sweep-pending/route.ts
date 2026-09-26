// app/api/posts/sweep-pending/route.ts — publica posts presos em `pending`.
//
// Chamado pelo pg_cron do Supabase a cada 10 min (função
// `run_posts_sweep()`, migration 2026-09-26-posts-sweep-pending.sql). A lógica
// está em `sweepPendingPosts` (lib/api/_services/post-approval.ts): roda a
// MESMA moderação de /api/posts/approve nos posts que o app gravou mas não
// chegou a aprovar (app fechado ou rede caída no meio da publicação).
//
// Autenticação: header `x-internal-secret` = `PUSH_INTERNAL_SECRET`, o mesmo
// segredo interno que o banco já usa pra chamar /api/push-notify (o valor já
// existe nos dois lados: env do Worker e `app_settings.push_internal_secret`).
// Quem tiver o segredo só consegue ADIANTAR a moderação de posts pendentes —
// nada que um usuário não dispare publicando — e o rate limit por IP corta a
// repetição.

import { type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import {
  checkRateLimit,
  getClientIp,
  jsonResponse,
  rateLimitResponse,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { safeEqual } from '@/lib/api/_services/whatsapp';
import { sweepPendingPosts } from '@/lib/api/_services/post-approval';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  const segredo = getRuntimeEnv('PUSH_INTERNAL_SECRET');
  if (!segredo) return jsonResponse({ ok: false, error: 'desativado' }, 503);
  const enviado = request.headers.get('x-internal-secret') || '';
  if (!enviado || !safeEqual(enviado, segredo)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const rl = await checkRateLimit({
    userId: `ip:${getClientIp(request)}`,
    endpoint: 'posts-sweep',
    limit: 6,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const r = await sweepPendingPosts();
    if (r.encontrados > 0) console.log('[post-sweep]', JSON.stringify(r));
    return jsonResponse({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('[post-sweep] erro', e instanceof Error ? e.message : e);
    return jsonResponse({ ok: false, error: 'erro interno' }, 500);
  }
}
