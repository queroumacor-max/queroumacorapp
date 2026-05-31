// app/api/generate-logo/route.ts — port de `functions/api/generate-logo.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { generateLogo } from '@/lib/api/_services/generate-logo';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY não configurada' },
      { status: 503 }
    );
  }
  let body: { name?: unknown; style?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'generate-logo',
    limit: 3,
  });
  if (g instanceof NextResponse) return g;
  try {
    return NextResponse.json(
      await generateLogo({ name: body?.name, style: body?.style })
    );
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('generate-logo crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
