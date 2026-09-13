// app/api/area-from-photo/route.ts — port de `functions/api/area-from-photo.js`.
// Multipart.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAIForm,
  gateAiUsage,
  recordAiUsage,
  rejectOversizedBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { estimateAreaFromPhoto } from '@/lib/api/_services/area-from-photo';
import { getRuntimeEnv } from '../../../lib/api/env';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!getRuntimeEnv('OPENAI_API_KEY')) {
    return NextResponse.json(
      { error: 'IA de visão não configurada: defina OPENAI_API_KEY' },
      { status: 503 }
    );
  }
  // Auditoria 2026-09-13: mesmo pré-check; o teto de 8MB da foto já existe em area-from-photo.ts, checado só pós-parse.
  const oversized = rejectOversizedBody(request, 9 * 1024 * 1024);
  if (oversized) return oversized;
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
