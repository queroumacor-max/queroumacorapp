// app/api/posts/approve/route.ts — o servidor modera e publica o post.
//
// O post nasce `pending` (o banco força — trigger enforce_post_moderation) e
// só vai ao feed quando ESTA rota aprova. A lógica está em
// lib/api/_services/post-approval.ts; aqui é só auth, limites e resposta.
//
// Respostas:
//   200 {status:'approved', revisao?}  publicado (revisao = foi pra fila humana)
//   200 {status:'rejected', reasons}    reprovado; o post já foi retirado
//   401/403/404/409/429/503             o post continua `pending` (invisível)

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  gateAiUsage,
  rateLimitResponse,
  recordAiUsage,
  rejectOversizedBody,
  requireAuth,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { errorResponse } from '@/lib/api/errors';
import { approvePost } from '@/lib/api/_services/post-approval';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const grande = rejectOversizedBody(request, 16 * 1024);
  if (grande) return grande;
  let body: { accessToken?: unknown; postId?: unknown; revalidarTexto?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const postId = typeof body?.postId === 'string' ? body.postId : '';
  if (!UUID.test(postId)) {
    return NextResponse.json({ error: 'postId inválido' }, { status: 400 });
  }
  const auth = await requireAuth(request, body);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  if (!auth.user) return NextResponse.json({ error: 'Faça login' }, { status: 401 });
  const userId = auth.user.id;

  const rl = await checkRateLimit({ userId, endpoint: 'post-approve', limit: 20 });
  if (!rl.allowed) return rateLimitResponse(rl);
  const gate = await gateAiUsage({ userId, email: auth.user.email, feature: 'moderate' });
  if (gate instanceof NextResponse) return gate;

  try {
    const out = await approvePost({ userId, postId, revalidarTexto: body?.revalidarTexto === true });
    await recordAiUsage({ userId, feature: out.video ? 'moderate_video' : 'moderate' });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return errorResponse(e, {
      status: 500,
      clientMessage: 'erro interno',
      tags: { route: 'posts-approve' },
    });
  }
}
