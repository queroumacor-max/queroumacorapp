// app/api/moderate/route.ts — port de `functions/api/moderate.js`.
// NÃO usa gateProAI — moderate é livre pra todos os logados (não PRO-only)
// porque qualquer post passa por moderação. Auth obrigatório.

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  gateAiUsage,
  rateLimitResponse,
  recordAiUsage,
  requireAuth,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { moderateContent } from '@/lib/api/_services/moderate';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        flagged: false,
        error: 'GEMINI_API_KEY não configurada',
        engine: 'none',
      },
      { status: 503 }
    );
  }
  let body: { text?: unknown; imageUrl?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const auth = await requireAuth(request, body);
  if (auth.error)
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  if (!auth.user)
    return NextResponse.json({ error: 'Faça login' }, { status: 401 });
  const rl = await checkRateLimit({
    userId: auth.user.id,
    endpoint: 'moderate',
    limit: 20,
  });
  if (!rl.allowed) return rateLimitResponse(rl);
  const aiGate = await gateAiUsage({
    userId: auth.user.id,
    email: auth.user.email,
    feature: 'moderate',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await moderateContent({
      text: body?.text,
      imageUrl: body?.imageUrl,
    });
    await recordAiUsage({ userId: auth.user.id, feature: 'moderate' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('moderate crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
