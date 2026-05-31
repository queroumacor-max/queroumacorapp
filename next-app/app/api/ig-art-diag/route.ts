// app/api/ig-art-diag/route.ts — port de `functions/api/ig-art-diag.js`.
// GET — diagnóstico de modelos disponíveis. PRO + admin (mesmo gate do vanilla).

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { diagnoseIgArt } from '@/lib/api/_services/ig-art-diag';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const g = await gateProAI(request, {}, {
    endpoint: 'ig-art-diag',
    limit: 10,
  });
  if (g instanceof NextResponse) return g;
  try {
    const testOpenAI =
      new URL(request.url).searchParams.get('openai') === '1';
    return NextResponse.json(await diagnoseIgArt({ testOpenAI }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('ig-art-diag crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
