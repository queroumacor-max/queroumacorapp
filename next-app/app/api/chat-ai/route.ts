// app/api/chat-ai/route.ts — port de `functions/api/chat-ai.js`.
// Chat com o Seu Zé (PRO + rate-limit 20/min).

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { chatWithSeuZe } from '@/lib/api/_services/chat-ai';

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
  const g = await gateProAI(request, body, { endpoint: 'chat-ai', limit: 20 });
  if (g instanceof NextResponse) return g;
  try {
    return NextResponse.json(
      await chatWithSeuZe({ message: body?.message, history: body?.history })
    );
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('chat-ai crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
