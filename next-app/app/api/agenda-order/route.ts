// app/api/agenda-order/route.ts — port de `functions/api/agenda-order.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { orderAgenda } from '@/lib/api/_services/agenda-order';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' },
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
  try {
    return NextResponse.json(
      await orderAgenda({ date: body?.date, jobs: body?.jobs })
    );
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('agenda-order crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
