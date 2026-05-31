// app/api/pricing-suggest/route.ts — port de `functions/api/pricing-suggest.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { suggestPricing } from '@/lib/api/_services/pricing-suggest';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY' },
      { status: 502 }
    );
  }
  let body: {
    service_type?: unknown;
    description?: unknown;
    area_m2?: unknown;
    accessToken?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'pricing-suggest',
    limit: 15,
  });
  if (g instanceof NextResponse) return g;
  try {
    return NextResponse.json(
      await suggestPricing({
        service_type: body?.service_type,
        description: body?.description,
        area_m2: body?.area_m2,
      })
    );
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('pricing-suggest crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
