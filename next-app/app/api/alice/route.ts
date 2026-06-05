// app/api/alice/route.ts — chat com a Alice Codessi (designer de interiores).
// Versão non-PRO do /api/chat-ai pra cliente final logado. Mesma infra de
// rate-limit (20/min), mesma cota mensal de IA por plano (free=30/pro=500),
// só sem o gate de PRO.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { chatWithPersona } from '@/lib/api/_services/chat-ai';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' },
      { status: 503 }
    );
  }
  let body: { message?: unknown; history?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  // requirePro: false → só auth + rate-limit. Cliente final não tem PRO.
  const g = await gateProAI(request, body, {
    endpoint: 'alice',
    limit: 20,
    requirePro: false,
  });
  if (g instanceof NextResponse) return g;

  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'alice',
  });
  if (aiGate instanceof NextResponse) return aiGate;

  try {
    const result = await chatWithPersona({
      persona: 'alice',
      message: body?.message,
      history: body?.history,
    });
    await recordAiUsage({ userId: g.userId, feature: 'alice' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('alice crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
