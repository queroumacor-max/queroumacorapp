// app/api/fe/route.ts — chat com o Fê (grafiteiro/muralista, PRO).
// Espelha /api/chat-ai (Seu Zé) mas usa persona 'fe'. Mesma gate PRO +
// rate-limit + cota mensal de IA.

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
  const g = await gateProAI(request, body, { endpoint: 'fe', limit: 20 });
  if (g instanceof NextResponse) return g;

  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'fe',
  });
  if (aiGate instanceof NextResponse) return aiGate;

  try {
    const result = await chatWithPersona({
      persona: 'fe',
      message: body?.message,
      history: body?.history,
    });
    await recordAiUsage({ userId: g.userId, feature: 'fe' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('fe crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
