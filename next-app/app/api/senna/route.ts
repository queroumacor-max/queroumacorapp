// app/api/senna/route.ts — chat com o Senna (funileiro/car details, PRO).
// Espelha /api/chat-ai (Seu Zé) mas usa persona 'senna'.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  rejectOversizedBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { chatWithPersona } from '@/lib/api/_services/chat-ai';
import { getRuntimeEnv } from '../../../lib/api/env';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!getRuntimeEnv('OPENAI_API_KEY') && !getRuntimeEnv('GEMINI_API_KEY')) {
    // Nome da env só no log do servidor (auditoria 2026-09-26, L3).
    console.warn('[senna] config ausente: IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY');
    return NextResponse.json(
      { error: 'Serviço indisponível no momento.' },
      { status: 503 }
    );
  }
  // Auditoria 2026-09-13: sem schema Zod aqui (diferente de /api/chat-ai) —
  // `message`/history` são truncados só DEPOIS do parse, dentro de
  // chatWithPersona. Pré-check de Content-Length corta corpo grande ANTES
  // do JSON.parse bufferizar tudo.
  const oversized = rejectOversizedBody(request, 256 * 1024);
  if (oversized) return oversized;
  let body: { message?: unknown; history?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, { endpoint: 'senna', limit: 20 });
  if (g instanceof NextResponse) return g;

  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'senna',
  });
  if (aiGate instanceof NextResponse) return aiGate;

  try {
    const result = await chatWithPersona({
      persona: 'senna',
      message: body?.message,
      history: body?.history,
    });
    await recordAiUsage({ userId: g.userId, feature: 'senna' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('senna crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
