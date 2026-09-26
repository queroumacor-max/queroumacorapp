// app/api/chat-ai/route.ts — port de `functions/api/chat-ai.js`.
// Chat com o Seu Zé (PRO + rate-limit 20/min).

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  rejectOversizedBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { chatWithSeuZe } from '@/lib/api/_services/chat-ai';
import { chatAiSchema, formatZodError } from '@/lib/api/schemas/chat-ai';
import { getRuntimeEnv } from '../../../lib/api/env';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!getRuntimeEnv('OPENAI_API_KEY') && !getRuntimeEnv('GEMINI_API_KEY')) {
    // Nome da env só no log do servidor (auditoria 2026-09-26, L3).
    console.warn('[chat-ai] config ausente: IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY');
    return NextResponse.json(
      { error: 'Serviço indisponível no momento.' },
      { status: 503 }
    );
  }
  // Auditoria 2026-09-13: pré-check barato de Content-Length ANTES do
  // parse — o Zod abaixo (chatAiSchema) já rejeita `message`/`history`
  // grandes, mas só DEPOIS de `request.json()` já ter bufferizado e
  // parseado o corpo inteiro. 256KB cobre message (10k) + history (20×10k)
  // com folga de sobra pro JSON em volta.
  const oversized = rejectOversizedBody(request, 256 * 1024);
  if (oversized) return oversized;
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
