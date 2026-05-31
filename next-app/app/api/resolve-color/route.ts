// app/api/resolve-color/route.ts — port de `functions/api/resolve-color.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { resolveColors } from '@/lib/api/_services/resolve-color';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' },
      { status: 503 }
    );
  }
  let body: { items?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'resolve-color',
    limit: 30,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'resolve_color',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await resolveColors({ items: body?.items });
    await recordAiUsage({ userId: g.userId, feature: 'resolve_color' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('resolve-color crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
