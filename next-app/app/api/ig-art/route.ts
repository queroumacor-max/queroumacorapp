// app/api/ig-art/route.ts — port de `functions/api/ig-art.js`. Gerador de arte
// IG. PRO + rate 5/min + hard-timeout outer pra garantir resposta antes do CF
// matar a função.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { errorResponse } from '@/lib/api/errors';
import { generateIgArt } from '@/lib/api/_services/ig-art';

export const runtime = 'edge';

const OUTER_HARD_TIMEOUT_MS = 28000;

export async function POST(request: NextRequest) {
  const hardTimeout = new Promise<NextResponse>((resolve) =>
    setTimeout(
      () =>
        resolve(
          NextResponse.json(
            {
              error: 'Tempo esgotado',
              detail:
                'Gerador de arte demorou mais que o limite. Tente novamente — pode ter sido pico de uso do provedor.',
            },
            { status: 504 }
          )
        ),
      OUTER_HARD_TIMEOUT_MS
    )
  );
  try {
    return await Promise.race([handle(request), hardTimeout]);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    // R-H11: detalhe da exception vai pro Sentry, cliente recebe msg amigável
    // sem leak (antes mandava `e.message` que vazava hostnames internos).
    return errorResponse(e, {
      status: 500,
      clientMessage: 'Erro interno',
      tags: { route: 'ig-art' },
    });
  }
}

async function handle(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, { endpoint: 'ig-art', limit: 5 });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'ig_art',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  const result = await generateIgArt({
    request,
    photoDataUrl: body.photoDataUrl,
    photoDataUrl2: body.photoDataUrl2,
    style: body.style,
    aspect: body.aspect,
    captionHint: body.captionHint,
    businessName: body.businessName,
  });
  await recordAiUsage({ userId: g.userId, feature: 'ig_art' });
  return NextResponse.json(result);
}
