// app/api/crm-draft/route.ts — port de `functions/api/crm-draft.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { draftReactivationMessage } from '@/lib/api/_services/crm-draft';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' },
      { status: 503 }
    );
  }
  let body: {
    clientName?: unknown;
    lastService?: unknown;
    monthsSince?: unknown;
    painterName?: unknown;
    accessToken?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'crm-draft',
    limit: 10,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'crm_draft',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await draftReactivationMessage({
      clientName: body?.clientName,
      lastService: body?.lastService,
      monthsSince: body?.monthsSince,
      painterName: body?.painterName,
    });
    await recordAiUsage({ userId: g.userId, feature: 'crm_draft' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('crm-draft crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
