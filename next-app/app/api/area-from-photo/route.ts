// app/api/area-from-photo/route.ts — port de `functions/api/area-from-photo.js`.
// Multipart.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAIForm,
  gateAiUsage,
  recordAiUsage,
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
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'area_from_photo',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await estimateAreaFromPhoto({ image: formData.get('image') });
    await recordAiUsage({ userId: g.userId, feature: 'area_from_photo' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('area-from-photo crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
