// app/api/moderate-video/route.ts — port de `functions/api/moderate-video.js`.
// Auth via verifyOwnerToken (não usa gateProAI porque moderação é universal).

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  gateAiUsage,
  getServiceKey,
  rateLimitResponse,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import {
  moderateVideoPost,
  verifyOwnerToken,
} from '@/lib/api/_services/moderate-video';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const serviceKey = getServiceKey();
  if (!process.env.GEMINI_API_KEY || !serviceKey) {
    return NextResponse.json(
      { status: 'pending', error: 'moderação de vídeo não configurada' },
      { status: 503 }
    );
  }
  let body: { accessToken?: unknown; postId?: unknown; caption?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const accessToken =
    typeof body?.accessToken === 'string' ? body.accessToken : '';
  const postId = typeof body?.postId === 'string' ? body.postId : '';
  const caption =
    typeof body?.caption === 'string' ? body.caption.slice(0, 2000) : '';
  if (!postId)
    return NextResponse.json({ error: 'postId obrigatório' }, { status: 400 });
  try {
    const uid = await verifyOwnerToken({ accessToken });
    const rl = await checkRateLimit({
      userId: uid,
      endpoint: 'moderate-video',
      limit: 3,
    });
    if (!rl.allowed) return rateLimitResponse(rl);
    const aiGate = await gateAiUsage({
      userId: uid,
      feature: 'moderate_video',
    });
    if (aiGate instanceof NextResponse) return aiGate;
    const out = await moderateVideoPost({ userId: uid, postId, caption });
    await recordAiUsage({ userId: uid, feature: 'moderate_video' });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.error('moderate-video crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
