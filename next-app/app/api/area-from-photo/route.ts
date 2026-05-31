// app/api/area-from-photo/route.ts — port de `functions/api/area-from-photo.js`.
// Multipart.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAIForm,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { estimateAreaFromPhoto } from '@/lib/api/_services/area-from-photo';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'IA de visão não configurada: defina OPENAI_API_KEY' },
      { status: 503 }
    );
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'FormData inválido' }, { status: 400 });
  }
  const g = await gateProAIForm(request, formData, {
    endpoint: 'area-from-photo',
    limit: 5,
  });
  if (g instanceof NextResponse) return g;
  try {
    return NextResponse.json(
      await estimateAreaFromPhoto({ image: formData.get('image') })
    );
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('area-from-photo crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
