// app/api/agenda-order/route.ts — port de `functions/api/agenda-order.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { orderAgenda } from '@/lib/api/_services/agenda-order';
import { getRuntimeEnv } from '../../../lib/api/env';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!getRuntimeEnv('OPENAI_API_KEY') && !getRuntimeEnv('GEMINI_API_KEY')) {
    // Nome da env só no log do servidor (auditoria 2026-09-26, L3).
    console.warn('[agenda-order] config ausente: IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY');
    return NextResponse.json(
      { error: 'Serviço indisponível no momento.' },
      { status: 503 }
    );
  }
  let body: { date?: unknown; jobs?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'agenda-order',
    limit: 5,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'agenda_order',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await orderAgenda({ date: body?.date, jobs: body?.jobs });
    await recordAiUsage({ userId: g.userId, feature: 'agenda_order' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('agenda-order crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
