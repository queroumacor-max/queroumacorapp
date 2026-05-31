// app/api/fin-analysis/route.ts — port de `functions/api/fin-analysis.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { analyzeFinancials } from '@/lib/api/_services/fin-analysis';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY' },
      { status: 503 }
    );
  }
  let body: {
    thisMonth?: unknown;
    lastMonth?: unknown;
    recentJobs?: unknown;
    accessToken?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'fin-analysis',
    limit: 5,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'fin_analysis',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await analyzeFinancials({
      thisMonth: body?.thisMonth,
      lastMonth: body?.lastMonth,
      recentJobs: body?.recentJobs,
    });
    await recordAiUsage({ userId: g.userId, feature: 'fin_analysis' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('fin-analysis crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
