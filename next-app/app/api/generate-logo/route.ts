// app/api/generate-logo/route.ts — port de `functions/api/generate-logo.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { generateLogo } from '@/lib/api/_services/generate-logo';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY não configurada' },
      { status: 503 }
    );
  }
  let body: { name?: unknown; style?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'generate-logo',
    limit: 3,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'generate_logo',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await generateLogo({ name: body?.name, style: body?.style });
    await recordAiUsage({ userId: g.userId, feature: 'generate_logo' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('generate-logo crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
