// app/api/ig-art/route.ts — port de `functions/api/ig-art.js`. Gerador de arte
// IG. PRO + rate 5/min + hard-timeout outer pra garantir resposta antes do CF
// matar a função.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
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
    console.error('ig-art handler-crash:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        error: 'Erro interno',
        detail: String(e instanceof Error ? e.message : e).slice(0, 200),
      },
      { status: 500 }
    );
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
  const result = await generateIgArt({
    request,
    photoDataUrl: body.photoDataUrl,
    photoDataUrl2: body.photoDataUrl2,
    style: body.style,
    aspect: body.aspect,
    captionHint: body.captionHint,
    businessName: body.businessName,
  });
  return NextResponse.json(result);
}
