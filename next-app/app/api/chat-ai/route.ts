// app/api/chat-ai/route.ts — port de `functions/api/chat-ai.js`.
// Chat com o Seu Zé (PRO + rate-limit 20/min).

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { chatWithSeuZe } from '@/lib/api/_services/chat-ai';
import { chatAiSchema, formatZodError } from '@/lib/api/schemas/chat-ai';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' },
      { status: 503 }
    );
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = chatAiSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodError(parsed.error.issues), { status: 400 });
  }
  const body = parsed.data;
  const g = await gateProAI(request, body, { endpoint: 'chat-ai', limit: 20 });
  if (g instanceof NextResponse) return g;

  // Hardening#18/#19: limite mensal de IA por plano. APÓS gateProAI
  // (auth+rate por minuto) e ANTES de chamar upstream.
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'chat_ai',
  });
  if (aiGate instanceof NextResponse) return aiGate;

  try {
    const result = await chatWithSeuZe({
      message: body.message,
      history: body.history,
    });
    // Conta o uso só após sucesso da chamada upstream.
    await recordAiUsage({ userId: g.userId, feature: 'chat_ai' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('chat-ai crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
